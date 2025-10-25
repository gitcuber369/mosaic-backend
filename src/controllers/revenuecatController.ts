import crypto from "crypto";
import { Request, Response } from "express";
import { getDb, getUsersCollection } from "../db";
import FirebaseAnalytics from "../firebaseConfig";

const PRODUCT_CREDIT_MAP: Record<string, number> = {
  "com.mosaic.credits_10": 10, // one-time purchase
};

// Idempotency helpers
async function markEventProcessed(db: any, eventId: string) {
  try {
    await db.collection("processedEvents").insertOne({
      eventId,
      createdAt: new Date(),
    });
    console.log(`Event ${eventId} marked as processed`);
    return true;
  } catch {
    console.warn(`Event ${eventId} already processed`);
    return false;
  }
}

async function hasEventBeenProcessed(db: any, eventId: string) {
  const f = await db.collection("processedEvents").findOne({ eventId });
  return !!f;
}

// Ensure index for idempotency
(async () => {
  try {
    const db = getDb();
    await db
      .collection("processedEvents")
      .createIndex({ eventId: 1 }, { unique: true });
  } catch {}
})();

export async function handleRevenuecatWebhook(req: Request, res: Response) {
  try {
    const rawBody = req.body as Buffer | string;

    // Auth verification
    const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
    const actualAuth = (
      req.headers.authorization ||
      req.headers.Authorization ||
      ""
    ).toString();
    if (expectedAuth && actualAuth.trim() !== expectedAuth.trim()) {
      console.warn("Unauthorized webhook call");
      return res.status(401).send("unauthorized");
    }
    if (!rawBody) return res.status(400).send("missing body");

    // Signature verification
    const signatureHeader =
      (req.headers["x-revenuecat-signature"] as string) ||
      (req.headers["revenuecat-signature"] as string) ||
      (req.headers["signature"] as string);

    if (process.env.REVENUECAT_WEBHOOK_SECRET) {
      if (!signatureHeader) return res.status(401).send("no signature");
      const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");
      if (
        !crypto.timingSafeEqual(
          Buffer.from(signatureHeader, "utf8"),
          Buffer.from(expected, "utf8")
        )
      ) {
        console.warn("Invalid signature");
        return res.status(401).send("invalid signature");
      }
    }

    // Parse payload
    const payload: any = Buffer.isBuffer(rawBody)
      ? JSON.parse(rawBody.toString("utf8"))
      : typeof rawBody === "string"
      ? JSON.parse(rawBody)
      : rawBody;

    const rcEvent = payload.event || payload.data?.event || payload;
    const eventId =
      rcEvent.id ||
      rcEvent.event_id ||
      payload.request_id ||
      payload.delivery_id ||
      payload.data?.id;

    const db = getDb();
    if (eventId && (await hasEventBeenProcessed(db, eventId))) {
      console.log(`Duplicate event received: ${eventId}`);
      return res.status(200).send("ok");
    }

    const users = getUsersCollection();

    const appUserId =
      rcEvent.app_user_id ||
      rcEvent.original_app_user_id ||
      payload.app_user_id ||
      payload.data?.subscriber?.app_user_id;

    const productId =
      rcEvent.product_id ||
      payload.product_id ||
      payload.data?.product_id ||
      payload.data?.product?.product_id;

    console.log("---- RevenueCat Event ----");
    console.log("Event type:", rcEvent.type);
    console.log("App User ID:", appUserId);
    console.log("Product ID:", productId);
    console.log("Raw event:", JSON.stringify(rcEvent, null, 2));
    console.log("--------------------------");

    async function findUserByAppUserId(appUserIdToFind: string | undefined) {
      if (!appUserIdToFind) return null;
      let u = await users.findOne({ revenuecatAppUserId: appUserIdToFind });
      if (u) return u;
      u = await users.findOne({ appUserId: appUserIdToFind });
      if (u) return u;
      const email = payload?.data?.subscriber?.email?.value || appUserIdToFind;
      if (email && email.includes("@")) {
        u = await users.findOne({ email });
      }
      return u;
    }

    const reasons: string[] = [];

    // Handle consumable credits
    if (productId && PRODUCT_CREDIT_MAP[productId]) {
      const user = await findUserByAppUserId(appUserId);
      if (user) {
        await users.updateOne(
          { _id: user._id },
          { $inc: { storyListenCredits: PRODUCT_CREDIT_MAP[productId] } }
        );
        console.log(
          `Granted ${PRODUCT_CREDIT_MAP[productId]} credits to user ${user._id}`
        );
        await FirebaseAnalytics.trackEvent("revenuecat_consumable_granted", {
          appUserId,
          productId,
          credits: PRODUCT_CREDIT_MAP[productId],
        });
      } else {
        reasons.push("User not found for consumable credit grant");
      }
    }

    // Handle subscription events - works with both nested subscriber object and direct event data
    const subscriber =
      payload.data?.subscriber || payload.subscriber || payload.data;
    const eventType = (rcEvent.type || "").toUpperCase();

    // Check if this is a subscription-related event (even without full subscriber object)
    const hasEntitlementData =
      rcEvent.entitlement_ids?.includes("RC-Mosaic-AI") ||
      subscriber?.entitlements?.["RC-Mosaic-AI"]?.is_active;

    const hasExpirationDate =
      rcEvent.expiration_at_ms || rcEvent.expires_date_ms;

    const isSubscriptionEvent =
      hasEntitlementData ||
      hasExpirationDate ||
      [
        "INITIAL_PURCHASE",
        "RENEWAL",
        "NON_RENEWING_PURCHASE",
        "PRODUCT_CHANGE",
        "UNCANCELLATION",
        "CANCELLATION",
        "EXPIRATION",
        "BILLING_ISSUE",
        "SUBSCRIPTION_PAUSED",
        "REFUND",
        "REFUND_REVERSED",
      ].includes(eventType);

    if (isSubscriptionEvent) {
      const rcAppUserId =
        appUserId ||
        subscriber?.app_user_id ||
        subscriber?.original_app_user_id;
      let user = await findUserByAppUserId(rcAppUserId);

      if (!user) {
        console.warn("User not found for subscription event");
        reasons.push("User not found for subscription event");
        if (eventId) await markEventProcessed(db, eventId);
        return res.status(200).send("ok");
      }

      if (!user.revenuecatAppUserId) {
        await users.updateOne(
          { _id: user._id },
          { $set: { revenuecatAppUserId: rcAppUserId } }
        );
      }

      // Extract subscription data from either subscriber object or direct event data
      let latestSub: {
        id: string;
        product_id: string;
        expires: number;
      } | null = null;

      // Try to get from subscriber.subscriptions first
      const subscriptions = subscriber?.subscriptions || {};
      for (const key of Object.keys(subscriptions)) {
        const s = subscriptions[key];
        const expMs = s?.expires_date_ms || s?.expiration_date_ms;
        if (!expMs) continue;
        if (!latestSub || expMs > latestSub.expires) {
          latestSub = {
            id: s.original_transaction_id || s.id || key,
            product_id: s.product_id || key,
            expires: Number(expMs),
          };
        }
      }

      // If no subscriber data, use event data directly
      if (!latestSub && hasExpirationDate) {
        const expirationMs = Number(
          rcEvent.expiration_at_ms || rcEvent.expires_date_ms
        );
        latestSub = {
          id:
            rcEvent.original_transaction_id ||
            rcEvent.transaction_id ||
            rcEvent.id,
          product_id: rcEvent.new_product_id || rcEvent.product_id || productId,
          expires: expirationMs,
        };
        reasons.push("Using expiration data from event directly");
      }

      const hasEntitlement = hasEntitlementData;

      if (!latestSub && !hasEntitlement) {
        reasons.push("No subscription data found in event");
      }

      // Calculate premium status from available data
      let isPremiumNow =
        hasEntitlement || (latestSub ? latestSub.expires > Date.now() : false);

      const premiumExpiresAt = latestSub
        ? new Date(latestSub.expires)
        : user.premiumExpiresAt;
      const subscriptionId =
        latestSub?.id || rcEvent.transaction_id || rcEvent.id;

      // Initialize update operations
      const updateOps: any = {
        $set: {
          revenuecatSubscriptionId: subscriptionId,
          premiumExpiresAt,
        },
      };

      // Determine if we should grant credits
      let shouldGrantCredits = false;
      if (user.revenuecatSubscriptionId !== subscriptionId) {
        shouldGrantCredits = true;
      } else {
        reasons.push(
          "Credits not granted: subscriptionId matches existing user record"
        );
      }

      // Event-specific handling
      switch (eventType) {
        case "INITIAL_PURCHASE":
          updateOps.$set.isPremium = true;
          updateOps.$set.isPaused = false;
          if (shouldGrantCredits) {
            updateOps.$set.storyListenCredits = (user?.tokens || 0) + 30;
          }
          reasons.push("Initial purchase - premium granted");
          break;

        case "RENEWAL":
          updateOps.$set.isPremium = true;
          updateOps.$set.isPaused = false;
          if (shouldGrantCredits) {
            updateOps.$set.storyListenCredits = (user?.tokens || 0) + 30;
          }
          reasons.push("Renewal - premium granted");
          break;

        case "NON_RENEWING_PURCHASE":
          updateOps.$set.isPremium = true;
          updateOps.$set.isPaused = false;
          if (shouldGrantCredits) {
            updateOps.$inc = { storyListenCredits: 10 };
          }
          reasons.push("Non-renewing purchase - premium granted");
          break;

        case "UNCANCELLATION":
          // User uncancelled - subscription is active
          updateOps.$set.isPremium = true;
          updateOps.$set.isPaused = false;
          if (shouldGrantCredits) {
            updateOps.$set.storyListenCredits = (user?.tokens || 0) + 30;
          }
          reasons.push("Uncancellation - premium granted");
          break;

        case "PRODUCT_CHANGE":
          updateOps.$set.isPaused = false;
          updateOps.$set.revenuecatSubscriptionId =
            rcEvent.new_product_id || latestSub?.product_id;
          // if (shouldGrantCredits) {
          //   updateOps.$set.storyListenCredits = (user?.tokens || 0) + 30;
          // }
          reasons.push(
            `Product changed to ${updateOps.$set.revenuecatSubscriptionId} - premium granted`
          );
          break;

        case "CANCELLATION":
          // User cancelled but subscription is still active until expiration
          updateOps.$set.isPremium = false;
          updateOps.$set.isCancelled = true;
          updateOps.$set.isPaused = false;
          reasons.push(
            `Cancellation - isPremium set to ${isPremiumNow} based on expiration date`
          );
          break;

        case "EXPIRATION":
          updateOps.$set.isPremium = false;
          updateOps.$set.isPaused = false;
          reasons.push("Subscription expired - premium removed");
          break;

        case "SUBSCRIPTION_PAUSED":
          updateOps.$set.isPremium = false;
          updateOps.$set.isPaused = true;
          reasons.push("Subscription paused - premium removed");
          break;

        case "BILLING_ISSUE":
          updateOps.$set.isPremium = isPremiumNow;
          reasons.push(
            `Billing issue detected - isPremium set to ${isPremiumNow}`
          );
          break;

        case "REFUND":
          updateOps.$set.isPremium = false;
          updateOps.$set.isPaused = false;
          reasons.push("Refund issued - premium removed");
          break;

        case "REFUND_REVERSED":
          updateOps.$set.isPremium = true;
          updateOps.$set.isPaused = false;
          reasons.push("Refund reversed - premium re-granted");
          break;

        default:
          // For unknown events, trust the calculated data
          updateOps.$set.isPremium = isPremiumNow;
          if (shouldGrantCredits && isPremiumNow) {
            updateOps.$inc = { storyListenCredits: 30 };
          }
          reasons.push(
            `Event type '${eventType}' - isPremium set to ${isPremiumNow} based on available data`
          );
          break;
      }

      await users.updateOne({ _id: user._id }, updateOps);

      console.log(
        `User ${user._id} updated:`,
        JSON.stringify(updateOps, null, 2)
      );
      console.log(`User ${user._id} update reasons:`, reasons.join("; "));

      await FirebaseAnalytics.trackEvent("revenuecat_subscription_update", {
        appUserId,
        productId,
        eventType: rcEvent.type,
        creditsGranted: updateOps.$inc?.storyListenCredits || 0,
        isPremium: updateOps.$set.isPremium,
        reasons,
      });
    }

    if (eventId) await markEventProcessed(db, eventId);

    return res.status(200).send("ok");
  } catch (err) {
    console.error("RevenueCat webhook error", err);
    return res.status(500).send("server error");
  }
}

export default handleRevenuecatWebhook;

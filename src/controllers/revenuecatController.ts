import crypto from "crypto";
import { Request, Response } from "express";
import { getDb, getUsersCollection } from "../db";
import FirebaseAnalytics from "../firebaseConfig";

// Map RevenueCat product IDs to consumable credits (one-time purchases)
const PRODUCT_CREDIT_MAP: Record<string, number> = {
  "com.mosaic.credits_10": 10,
  // add more consumable product IDs if needed
};

// Idempotency: mark an event as processed
async function markEventProcessed(db: any, eventId: string) {
  const coll = db.collection("processedEvents");
  try {
    await coll.insertOne({ eventId, createdAt: new Date() });
    console.log(`Event ${eventId} marked as processed`);
    return true;
  } catch (err) {
    console.warn(`Event ${eventId} already processed`);
    return false; // duplicate event
  }
}

// Check if an event was already processed
async function hasEventBeenProcessed(db: any, eventId: string) {
  const coll = db.collection("processedEvents");
  const f = await coll.findOne({ eventId });
  return !!f;
}

// Ensure unique index for idempotency
(async () => {
  try {
    const db = getDb();
    const coll = db.collection("processedEvents");
    await coll.createIndex({ eventId: 1 }, { unique: true });
  } catch {}
})();

// POST /api/revenuecat/webhook
export async function handleRevenuecatWebhook(req: Request, res: Response) {
  try {
    const rawBody = req.body as Buffer | string;

    // Verify basic auth
    const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
    const actualAuth = (req.headers.authorization ||
      req.headers.Authorization ||
      "") as string;
    if (expectedAuth && actualAuth.trim() !== expectedAuth.trim()) {
      console.warn("Unauthorized webhook call");
      return res.status(401).send("unauthorized");
    }

    if (!rawBody) return res.status(400).send("missing body");

    // Verify signature if secret is provided
    const signatureHeader =
      (req.headers["x-revenuecat-signature"] as string) ||
      (req.headers["revenuecat-signature"] as string) ||
      (req.headers["signature"] as string);

    if (process.env.REVENUECAT_WEBHOOK_SECRET) {
      if (!signatureHeader) return res.status(401).send("no signature");
      const secret = process.env.REVENUECAT_WEBHOOK_SECRET as string;
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");
      const sigBuf = Buffer.from(signatureHeader, "utf8");
      const expBuf = Buffer.from(expected, "utf8");
      if (
        sigBuf.length !== expBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expBuf)
      ) {
        console.warn("Invalid signature");
        return res.status(401).send("invalid signature");
      }
    }

    // Parse payload
    let payload: any;
    if (Buffer.isBuffer(rawBody))
      payload = JSON.parse(rawBody.toString("utf8"));
    else if (typeof rawBody === "string") payload = JSON.parse(rawBody);
    else payload = rawBody;

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
      payload.data?.app_user_id ||
      payload.data?.subscriber?.app_user_id;

    const productId =
      rcEvent.product_id ||
      payload.product_id ||
      payload.data?.product_id ||
      payload.data?.product?.product_id ||
      payload.data?.product?.id;

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
      const email = payload?.data?.subscriber?.email;
      if (email) u = await users.findOne({ email });
      return u;
    }

    // Handle consumable credits (one-time purchases)
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
        console.warn("User not found for consumable purchase");
      }
    }

    // Handle subscriptions and entitlements
    const subscriber =
      payload.data?.subscriber || payload.subscriber || payload.data;
    if (subscriber) {
      const rcAppUserId =
        appUserId ||
        subscriber?.app_user_id ||
        subscriber?.original_app_user_id;

      let user = await findUserByAppUserId(rcAppUserId);
      if (!user) {
        console.warn("User not found for subscription event");
        return res.status(200).send("ok");
      }

      if (!user.revenuecatAppUserId) {
        await users.updateOne(
          { _id: user._id },
          { $set: { revenuecatAppUserId: rcAppUserId } }
        );
      }

      // Determine latest subscription
      const subscriptions = subscriber.subscriptions || {};
      let latestSub: {
        id: string;
        product_id: string;
        expires: number;
      } | null = null;
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

      const hasEntitlement =
        subscriber.entitlements?.["RC-Mosaic-AI"]?.is_active ||
        (rcEvent.entitlement_ids &&
          rcEvent.entitlement_ids.includes("RC-Mosaic-AI"));

      let isPremiumNow = false;
      let premiumExpiresAt: Date | null = null;
      let subscriptionId: string | null = null;

      if (latestSub) {
        premiumExpiresAt = new Date(latestSub.expires);
        subscriptionId = latestSub.id;
        isPremiumNow = premiumExpiresAt > new Date();
      } else if (hasEntitlement) {
        isPremiumNow = true;
      }

      if (!subscriptionId)
        subscriptionId = rcEvent.transaction_id || rcEvent.id;

      // Determine credits to grant
      const incrementCredits =
        subscriptionId && user.revenuecatSubscriptionId !== subscriptionId
          ? 30
          : 0;

      const update: any = {
        isPremium: isPremiumNow,
        premiumExpiresAt: premiumExpiresAt || user.premiumExpiresAt,
      };
      if (subscriptionId) update.revenuecatSubscriptionId = subscriptionId;
      const updateOps: any = { $set: update };
      if (incrementCredits > 0)
        updateOps.$inc = { storyListenCredits: incrementCredits };

      // Handle specific event types with logging
      switch ((rcEvent.type || "").toUpperCase()) {
        case "INITIAL_PURCHASE":
        case "RENEWAL":
        case "UNCANCELLATION":
        case "SUBSCRIPTION_EXTENDED":
        case "TEMPORARY_ENTITLEMENT_GRANT":
        case "NON_RENEWING_PURCHASE":
          console.log(`Subscription active or granted: ${user._id}`);
          break;

        case "CANCELLATION":
          updateOps.$set.isPremium = false;
          console.log(`Subscription cancelled for user: ${user._id}`);
          break;

        case "PRODUCT_CHANGE":
          updateOps.$set.revenuecatSubscriptionId =
            latestSub?.product_id ||
            rcEvent.new_product_id ||
            rcEvent.product_id;
          console.log(
            `Product change for user ${user._id} to ${updateOps.$set.revenuecatSubscriptionId}`
          );
          break;

        case "BILLING_ISSUE":
          updateOps.$set.billingIssue = true;
          console.warn(`Billing issue for user ${user._id}`);
          break;

        case "TRANSFER":
          console.log(`TRANSFER event received for user ${user._id}`);
          break;

        case "SUBSCRIPTION_PAUSED":
          updateOps.$set.isPaused = true;
          console.log(`Subscription paused for user ${user._id}`);
          break;

        case "EXPIRATION":
          updateOps.$set.isPremium = false;
          console.log(`Subscription expired for user ${user._id}`);
          break;

        case "INVOICE_ISSUANCE":
          console.log(`Invoice issued for user ${user._id}`);
          break;

        case "REFUND_REVERSED":
          updateOps.$set.isPremium = true;
          console.log(`Refund reversed, user ${user._id} re-granted premium`);
          break;

        default:
          console.log(
            `Unhandled event type: ${rcEvent.type} for user ${user._id}`
          );
          break;
      }

      await users.updateOne({ _id: user._id }, updateOps);
      await FirebaseAnalytics.trackEvent("revenuecat_subscription_update", {
        appUserId,
        productId,
        eventType: rcEvent.type,
        creditsGranted: incrementCredits,
        isPremium: isPremiumNow,
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

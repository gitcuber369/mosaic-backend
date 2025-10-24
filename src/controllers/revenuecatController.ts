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
      const email = payload?.data?.subscriber?.email?.value;
      if (email) u = await users.findOne({ email });
      return u;
    }

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
      }
    }

    // Handle subscriptions / entitlements
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

      const isPremiumNow = latestSub
        ? latestSub.expires > Date.now()
        : hasEntitlement;
      const premiumExpiresAt = latestSub
        ? new Date(latestSub.expires)
        : user.premiumExpiresAt;
      const subscriptionId =
        latestSub?.id || rcEvent.transaction_id || rcEvent.id;

      // Default update
      const updateOps: any = {
        $set: {
          isPremium: isPremiumNow,
          premiumExpiresAt,
          revenuecatSubscriptionId: subscriptionId,
        },
      };

      // Determine if we should grant credits
      if (user.revenuecatSubscriptionId !== subscriptionId) {
        updateOps.$inc = { storyListenCredits: 30 };
      }

      // Event-specific overrides
      switch ((rcEvent.type || "").toUpperCase()) {
        case "CANCELLATION":
        case "EXPIRATION":
          updateOps.$set.isPremium = false;
          console.log(
            `Premium removed for user ${user._id} due to ${rcEvent.type}`
          );
          break;
        case "PRODUCT_CHANGE":
          console.log(
            `Product change for user ${user._id} to ${
              rcEvent.new_product_id || latestSub?.product_id
            }`
          );
          updateOps.$set.revenuecatSubscriptionId =
            rcEvent.new_product_id || latestSub?.product_id;
          break;
        case "SUBSCRIPTION_PAUSED":
          updateOps.$set.isPaused = true;
          console.log(`Subscription paused for user ${user._id}`);
          break;
        case "REFUND_REVERSED":
          updateOps.$set.isPremium = true;
          console.log(
            `Refund reversed, re-granting premium to user ${user._id}`
          );
          break;
        default:
          console.log(
            `Processing subscription event ${rcEvent.type} for user ${user._id}`
          );
          break;
      }

      await users.updateOne({ _id: user._id }, updateOps);

      console.log(`User ${user._id} updated:`, updateOps);

      await FirebaseAnalytics.trackEvent("revenuecat_subscription_update", {
        appUserId,
        productId,
        eventType: rcEvent.type,
        creditsGranted: updateOps.$inc?.storyListenCredits || 0,
        isPremium: updateOps.$set.isPremium,
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

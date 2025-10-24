import crypto from "crypto";
import { Request, Response } from "express";
import { getDb, getUsersCollection } from "../db";
import FirebaseAnalytics from "../firebaseConfig";

// Map RevenueCat product IDs to consumable credits
const PRODUCT_CREDIT_MAP: Record<string, number> = {
  "com.mosaic.credits_10": 10,
  // Add more consumable product IDs here if needed
};

// Idempotency: Mark an event as processed
async function markEventProcessed(db: any, eventId: string) {
  const coll = db.collection("processedEvents");
  try {
    await coll.insertOne({ eventId, createdAt: new Date() });
    return true;
  } catch (err) {
    return false; // duplicate
  }
}

// Check if event was already processed
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

    // Verify basic auth header
    const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
    const actualAuth = (req.headers.authorization ||
      req.headers.Authorization ||
      "") as string;
    if (expectedAuth && actualAuth.trim() !== expectedAuth.trim()) {
      return res.status(401).send("unauthorized");
    }

    if (!rawBody) return res.status(400).send("missing body");

    // Verify signature if webhook secret is provided
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
    if (eventId && (await hasEventBeenProcessed(db, eventId)))
      return res.status(200).send("ok");

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

    console.log("Parsed RevenueCat event:", rcEvent);

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

    // Handle consumable credits
    if (productId && PRODUCT_CREDIT_MAP[productId]) {
      const user = await findUserByAppUserId(appUserId);
      if (user) {
        await users.updateOne(
          { _id: user._id },
          { $inc: { storyListenCredits: PRODUCT_CREDIT_MAP[productId] } }
        );
        await FirebaseAnalytics.trackEvent("revenuecat_consumable_granted", {
          appUserId,
          productId,
          credits: PRODUCT_CREDIT_MAP[productId],
        });
      }
    }

    // Handle subscription and entitlement
    const subscriber =
      payload.data?.subscriber || payload.subscriber || payload.data;
    if (subscriber) {
      const rcAppUserId =
        appUserId ||
        subscriber?.app_user_id ||
        subscriber?.original_app_user_id;
      let user = await findUserByAppUserId(rcAppUserId);
      if (!user) return res.status(200).send("ok");

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

      // Handle all event types
      switch ((rcEvent.type || "").toUpperCase()) {
        case "INITIAL_PURCHASE":
        case "RENEWAL":
        case "UNCANCELLATION":
        case "SUBSCRIPTION_EXTENDED":
        case "TEMPORARY_ENTITLEMENT_GRANT":
        case "NON_RENEWING_PURCHASE":
          {
            const incrementCredits =
              subscriptionId && user.revenuecatSubscriptionId === subscriptionId
                ? 0
                : 30;
            const update: any = {
              isPremium: true,
              premiumExpiresAt: premiumExpiresAt || user.premiumExpiresAt,
            };
            if (subscriptionId)
              update.revenuecatSubscriptionId = subscriptionId;
            const updateOps: any = { $set: update };
            if (incrementCredits > 0)
              updateOps.$inc = { storyListenCredits: incrementCredits };
            await users.updateOne({ _id: user._id }, updateOps);
          }
          break;

        case "CANCELLATION":
          await users.updateOne(
            { _id: user._id },
            { $set: { isPremium: false } }
          );
          break;

        case "PRODUCT_CHANGE":
          {
            // Optional: handle product upgrades/downgrades
            if (
              latestSub &&
              latestSub.product_id !== user.revenuecatSubscriptionId
            ) {
              await users.updateOne(
                { _id: user._id },
                { $set: { revenuecatSubscriptionId: latestSub.product_id } }
              );
            }
          }
          break;

        case "BILLING_ISSUE":
          // Optional: mark billing problem flag
          await users.updateOne(
            { _id: user._id },
            { $set: { billingIssue: true } }
          );
          break;

        case "TRANSFER":
          // Optional: handle merging/transferring user entitlements
          console.log("TRANSFER event: handle if needed");
          break;

        case "SUBSCRIPTION_PAUSED":
          await users.updateOne(
            { _id: user._id },
            { $set: { isPaused: true } }
          );
          break;

        case "EXPIRATION":
          await users.updateOne(
            { _id: user._id },
            { $set: { isPremium: false } }
          );
          break;

        case "INVOICE_ISSUANCE":
          // Optional: log or track invoice issued
          console.log("Invoice issued for user", user._id);
          break;

        case "REFUND_REVERSED":
          // Optional: re-grant credits if needed
          await users.updateOne(
            { _id: user._id },
            { $set: { isPremium: true } }
          );
          break;

        default:
          // fallback: if subscription active or entitlement active
          if (isPremiumNow) {
            const incrementCredits =
              subscriptionId && user.revenuecatSubscriptionId === subscriptionId
                ? 0
                : 30;
            const update: any = {
              isPremium: true,
              premiumExpiresAt: premiumExpiresAt || user.premiumExpiresAt,
            };
            if (subscriptionId)
              update.revenuecatSubscriptionId = subscriptionId;
            const updateOps: any = { $set: update };
            if (incrementCredits > 0)
              updateOps.$inc = { storyListenCredits: incrementCredits };
            await users.updateOne({ _id: user._id }, updateOps);
          } else {
            await users.updateOne(
              { _id: user._id },
              { $set: { isPremium: false } }
            );
          }
          break;
      }
    }

    if (eventId) await markEventProcessed(db, eventId);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("RevenueCat webhook error", err);
    return res.status(500).send("server error");
  }
}

export default handleRevenuecatWebhook;

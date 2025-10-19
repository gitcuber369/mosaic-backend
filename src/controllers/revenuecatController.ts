import { Request, Response } from 'express';
import crypto from 'crypto';
import { getUsersCollection, getDb } from '../db';
import FirebaseAnalytics from '../firebaseConfig';

// Map RevenueCat product ids to credit amounts
const PRODUCT_CREDIT_MAP: Record<string, number> = {
  'com.mosaic.credits_10': 10,
};

async function markEventProcessed(db: any, eventId: string) {
  const coll = db.collection('processedEvents');
  try {
    await coll.insertOne({ eventId, createdAt: new Date() });
    return true;
  } catch (err) {
    // Duplicate key or insert error -> return false meaning it likely already exists
    return false;
  }
}

async function hasEventBeenProcessed(db: any, eventId: string) {
  const coll = db.collection('processedEvents');
  const f = await coll.findOne({ eventId });
  return !!f;
}

// Ensure unique index for idempotency (best-effort at module load)
(async () => {
  try {
    const db = getDb();
    const coll = db.collection('processedEvents');
    await coll.createIndex({ eventId: 1 }, { unique: true });
    console.log('Ensured unique index on processedEvents.eventId');
  } catch (err) {
    // Database might not be connected yet during startup; ignore silently
  }
})();

// POST /api/revenuecat/webhook
export async function handleRevenuecatWebhook(req: Request, res: Response) {
  try {
    const rawBody = req.body as Buffer | string;

    if (!rawBody) {
      console.warn('RevenueCat webhook: missing raw body');
      return res.status(400).send('missing body');
    }

    const signatureHeader = (req.headers['x-revenuecat-signature'] as string) ||
      (req.headers['revenuecat-signature'] as string) ||
      (req.headers['signature'] as string) ||
      (req.headers['webhook-signature'] as string);

    // Verify signature if secret present
    if (process.env.REVENUECAT_WEBHOOK_SECRET) {
      if (!signatureHeader) {
        console.warn('RevenueCat webhook: no signature header provided');
        return res.status(401).send('no signature');
      }

      const secret = process.env.REVENUECAT_WEBHOOK_SECRET as string;
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      const sigBuf = Buffer.from(signatureHeader, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.warn('RevenueCat webhook: invalid signature', signatureHeader, expected);
        return res.status(401).send('invalid signature');
      }
    }

    const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));

    // Event id: RevenueCat payload shapes vary; check several fields
    const eventId = payload.event_id || payload.id || payload.request_id || payload.delivery_id || payload.data?.id;

    const db = getDb();

    if (eventId && await hasEventBeenProcessed(db, eventId)) {
      // already handled
      return res.status(200).send('ok');
    }

    // Extract app user id and product id
    const appUserId = payload.app_user_id || payload.data?.app_user_id || payload.data?.subscriber?.app_user_id || payload.data?.subscriber?.app_user_id;
    const productId = payload.product_id || payload.data?.product_id || payload.data?.product?.product_id || payload.data?.product?.id;
    const eventType = payload.event || payload.type || payload.data?.type || payload.data?.event_type;

    const users = getUsersCollection();

    // Consumable handling
    if (productId && PRODUCT_CREDIT_MAP[productId]) {
      if (!appUserId) {
        console.warn('RevenueCat webhook: consumable purchase but no app_user_id in payload', payload);
      } else {
        const creditsToGrant = PRODUCT_CREDIT_MAP[productId];
        // Try to find user by appUserId OR by email fallback
        let user = await users.findOne({ appUserId });
        if (!user && payload.data?.subscriber?.original_app_user_id) {
          user = await users.findOne({ appUserId: payload.data.subscriber.original_app_user_id });
        }
        if (!user && payload.data?.subscriber?.email) {
          user = await users.findOne({ email: payload.data.subscriber.email });
        }
        if (user) {
          await users.updateOne({ _id: user._id }, { $inc: { storyListenCredits: creditsToGrant } });
          console.log(`Granted ${creditsToGrant} credits to appUserId=${appUserId} (product=${productId})`);
          await FirebaseAnalytics.trackEvent('revenuecat_consumable_granted', { appUserId, productId, credits: creditsToGrant });
        } else {
          console.warn('RevenueCat webhook: user not found for appUserId', appUserId);
        }
      }
    }

    // Subscription / entitlement handling (robust)
    // payload.data.subscriber often contains entitlements and subscription objects
    const subscriber = payload.data?.subscriber || payload.subscriber || payload.data;
    if (subscriber) {
      const rcAppUserId = appUserId || subscriber?.app_user_id || subscriber?.original_app_user_id;
      if (rcAppUserId) {
        let user = await users.findOne({ appUserId: rcAppUserId });
        if (!user && subscriber?.email) {
          user = await users.findOne({ email: subscriber.email });
        }
        if (user) {
          // Look for subscriptions object and pick the subscription with the latest expiry
          let chosenSub: any = null;
          const subs = subscriber?.subscriptions || {};
          for (const key of Object.keys(subs || {})) {
            const s = subs[key];
            // normalize possible expiry fields
            const expiresMs = s?.expires_date_ms || s?.expiration_date_ms || s?.expires_date || null;
            const isActive = s?.is_active || s?.active || false;
            if (!chosenSub) {
              chosenSub = { key, s, expiresMs, isActive };
            } else {
              const prev = Number(chosenSub.expiresMs || 0);
              const cur = Number(expiresMs || 0);
              if (cur > prev) {
                chosenSub = { key, s, expiresMs, isActive };
              }
            }
          }

          // Also check entitlements for premium expiry if no subscriptions found
          let entitlementExpiryMs: any = subscriber?.entitlements?.premium?.expires_date_ms || null;

          // Determine incoming expiry and subscription id
          let incomingExpiryMs: number | null = null;
          let incomingSubId: string | null = null;
          let incomingProductId: string | null = null;

          if (chosenSub) {
            incomingExpiryMs = Number(chosenSub.expiresMs || null) || null;
            incomingSubId = chosenSub.s?.id || chosenSub.s?.original_transaction_id || chosenSub.s?.purchase_token || chosenSub.s?.transaction_id || chosenSub.key;
            incomingProductId = chosenSub.s?.product_id || chosenSub.s?.product_identifier || chosenSub.s?.store_product_id || chosenSub.key;
          } else if (entitlementExpiryMs) {
            incomingExpiryMs = Number(entitlementExpiryMs) || null;
          }

          let premiumExpiresAt: Date | undefined = undefined;
          if (incomingExpiryMs) {
            const ms = Number(incomingExpiryMs);
            if (!Number.isNaN(ms)) premiumExpiresAt = new Date(ms);
          }

          const isPremiumNow = premiumExpiresAt ? premiumExpiresAt > new Date() : (subscriber?.entitlements?.premium?.is_active || false);

          // Decide whether to update stored expiry / grant credits similar to Stripe logic
          const userBefore = await users.findOne({ _id: user._id });
          const storedExpiry = userBefore?.premiumExpiresAt ? new Date(userBefore.premiumExpiresAt) : null;

          if (premiumExpiresAt && (!storedExpiry || premiumExpiresAt > storedExpiry)) {
            // New subscription or renewal with newer expiry -> grant/set premium and credits
            if (!storedExpiry) {
              // initial purchase: set credits to 30 (overwrite)
              const update: any = {
                isPremium: true,
                premiumExpiresAt,
                revenuecatSubscriptionId: incomingSubId || undefined,
                storyListenCredits: 30,
              };
              await users.updateOne({ _id: user._id }, { $set: update });

              console.log(`Granted subscription and credits (initial) to appUserId=${rcAppUserId} (product=${incomingProductId})`);

              try {
                await FirebaseAnalytics.trackSubscription(
                  userBefore?._id?.toString() || 'unknown',
                  incomingProductId || 'unknown',
                  'created'
                );
              } catch (err) {
                console.warn('Failed to track subscription analytics', err);
              }
            } else {
              // renewal: increment credits by 30
              try {
                const result = await users.updateOne(
                  { _id: user._id },
                  {
                    $set: {
                      isPremium: true,
                      premiumExpiresAt,
                      revenuecatSubscriptionId: incomingSubId || undefined,
                    },
                    $inc: { storyListenCredits: 30 },
                  }
                );
                if (result.modifiedCount === 1) {
                  console.log(`Renewed subscription and granted credits to appUserId=${rcAppUserId}`);
                }
                try {
                  await FirebaseAnalytics.trackSubscription(
                    userBefore?._id?.toString() || 'unknown',
                    incomingProductId || 'unknown',
                    'updated'
                  );
                } catch (err) {
                  console.warn('Failed to track subscription analytics', err);
                }
              } catch (err) {
                console.error('Failed to apply renewal updates', err);
              }
            }
          } else {
            // If no premiumExpiresAt but entitlement shows is_active false, update user accordingly
            if (!premiumExpiresAt && !isPremiumNow) {
              await users.updateOne({ _id: user._id }, { $set: { isPremium: false } });
            }
          }

          // Handle explicit cancellation events if eventType indicates cancellation
          const evLower = (eventType || '').toString().toLowerCase();
          if (evLower.includes('cancel') || evLower.includes('deleted')) {
            try {
              await users.updateOne(
                { _id: user._id },
                {
                  $set: { isCancelled: true, isPremium: false },
                  $unset: { revenuecatSubscriptionId: '', premiumExpiresAt: '' },
                }
              );
              console.log(`Subscription cancelled for appUserId=${rcAppUserId}`);
            } catch (err) {
              console.error('Failed to mark subscription cancelled', err);
            }
          }

          // If there is an incoming subscription id and we don't have it stored, store it
          if (incomingSubId) {
            const u: any = user;
            if (!u.revenuecatSubscriptionId || u.revenuecatSubscriptionId !== incomingSubId) {
              await users.updateOne({ _id: user._id }, { $set: { revenuecatSubscriptionId: incomingSubId } });
            }
          }

          console.log(`Updated subscription state for appUserId=${rcAppUserId}: isPremium=${isPremiumNow}`);
        }
      }
    }

    // Mark event processed for idempotency
    if (eventId) {
      try {
        await markEventProcessed(db, eventId);
      } catch (err) {
        // ignore
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('RevenueCat webhook error', err);
    return res.status(500).send('server error');
  }
}

export default handleRevenuecatWebhook;

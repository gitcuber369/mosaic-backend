import type { Request, Response } from 'express';
import { getDb } from '../db';
import FirebaseAnalytics from '../firebaseConfig';

// Accept App Store Server Notifications (store for debugging + lightweight analytics)
export async function handleAppStoreNotification(req: Request, res: Response) {
  try {
    const payload = req.body;

    // Minimal validation
    if (!payload) {
      return res.status(400).json({ error: 'Missing body' });
    }

    const db = getDb();
    try {
      await db.collection('appStoreNotifications').insertOne({ payload, receivedAt: new Date() });
    } catch (e) {
      console.warn('Failed to persist app store notification', e);
    }

    // Track an analytics event (best-effort)
    try {
      await FirebaseAnalytics.trackEvent('apple_app_store_notification_received', {
        type: payload?.notificationType || payload?.type || 'unknown',
      });
    } catch (e) {
      // ignore
    }

    // Respond 200 quickly; Apple expects a 200 to consider it delivered
    res.status(200).send('ok');
  } catch (err) {
    console.error('Error handling App Store notification', err);
    res.status(500).send('server error');
  }
}

export default handleAppStoreNotification;

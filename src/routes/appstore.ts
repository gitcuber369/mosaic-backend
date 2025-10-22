import express from 'express';
import handleAppStoreNotification from '../controllers/appStoreController';

const router = express.Router();

// App Store Server Notifications (public endpoint)
router.post('/notifications', express.json(), handleAppStoreNotification);

export default router;

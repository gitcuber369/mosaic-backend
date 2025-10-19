import express from 'express';
import bodyParser from 'body-parser';
import handleRevenuecatWebhook from '../controllers/revenuecatController';

const router = express.Router();

// Public webhook endpoint (raw body required for signature verification)
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), handleRevenuecatWebhook);

export default router;

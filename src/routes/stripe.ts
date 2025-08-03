import express from 'express';
import { 
  createPaymentIntent, 
  handleStripeWebhook, 
  cancelSubscription, 
  getSubscriptionStatus,
  createSubscription,
  debugUser
} from '../controllers/stripeController';

const router = express.Router();

// Create payment intent for subscription
router.post('/create-payment-intent', createPaymentIntent);

// Create subscription after successful payment
router.post('/create-subscription', createSubscription);

// Handle Stripe webhooks
router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Cancel subscription
router.post('/cancel-subscription', cancelSubscription);

// Get subscription status
router.get('/subscription-status/:email', getSubscriptionStatus);

// Debug user data
router.get('/debug-user/:email', debugUser);

export default router; 
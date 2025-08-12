import express from 'express';
import { 
  createPaymentIntent, 
  handleStripeWebhook, 
  cancelSubscription, 
  getSubscriptionStatus,
  createSubscription,
  createExtraCreditsPaymentIntent,
  createExtraCreditsSetupIntent,
  createExtraCreditsCheckout,
  debugUser,
  resetUserPremium
} from '../controllers/stripeController';

const router = express.Router();

// Create payment intent for subscription
router.post('/create-payment-intent', createPaymentIntent);

// Create subscription after successful payment
router.post('/create-subscription', createSubscription);

// Create one-time PaymentIntent for 10 extra credits
router.post('/extra-credits/payment-intent', createExtraCreditsPaymentIntent);

// Create SetupIntent for 10 extra credits (to show same sheet as Premium)
router.post('/extra-credits/setup-intent', createExtraCreditsSetupIntent);

// Create Stripe Checkout session for 10 extra credits (browser redirect)
router.post('/extra-credits/checkout', createExtraCreditsCheckout);

// Handle Stripe webhooks
router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Cancel subscription
router.post('/cancel-subscription', cancelSubscription);

// Get subscription status
router.get('/subscription-status/:email', getSubscriptionStatus);

// Debug user data
router.get('/debug-user/:email', debugUser);

// Reset user premium status
router.post('/reset-premium/:email', resetUserPremium);

export default router; 
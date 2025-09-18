import bodyParser from "body-parser";
import express from "express";
import {
  buyCreditsIntent,
  cancelSubscription,
  createPaymentIntent,
  createSubscription,
  debugUser,
  getSubscriptionStatus,
  handleStripeWebhook,
  resetUserPremium,
} from "../controllers/stripeController";
import { authenticateToken } from "../middleware/auth";
// One-time payment intent for 10 credits
const router = express.Router();

/**
 * @swagger
 * /api/stripe/payment-intent:
 *   post:
 *     summary: Create a payment intent for subscription
 *     tags:
 *       - Stripe
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email of the user
 *               planType:
 *                 type: string
 *                 description: Plan type (e.g., monthly, yearly)
 *     responses:
 *       200:
 *         description: Payment intent created successfully
 *       400:
 *         description: Email or plan type is invalid
 *       500:
 *         description: Failed to create payment intent
 */

/**
 * @swagger
 * /api/stripe/subscription:
 *   post:
 *     summary: Create a subscription after successful setup intent
 *     tags:
 *       - Stripe
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email of the user
 *               setupIntentId:
 *                 type: string
 *                 description: ID of the setup intent
 *               planType:
 *                 type: string
 *                 description: Plan type (e.g., monthly, yearly)
 *     responses:
 *       200:
 *         description: Subscription created successfully
 *       400:
 *         description: Email, setupIntentId, or plan type is invalid
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Failed to create subscription
 */

/**
 * @swagger
 * /api/stripe/webhook:
 *   post:
 *     summary: Handle Stripe webhook events
 *     tags:
 *       - Stripe
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Invalid signature or missing signature
 *       500:
 *         description: Webhook processing failed
 */

/**
 * @swagger
 * /api/stripe/cancel-subscription:
 *   post:
 *     summary: Cancel subscription at the end of the current period
 *     tags:
 *       - Stripe
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email of the user
 *     responses:
 *       200:
 *         description: Subscription cancellation scheduled
 *       400:
 *         description: Email is required
 *       404:
 *         description: No active subscription found
 *       500:
 *         description: Failed to cancel subscription
 */

/**
 * @swagger
 * /api/stripe/subscription-status/{email}:
 *   get:
 *     summary: Get subscription status of a user
 *     tags:
 *       - Stripe
 *     parameters:
 *       - in: path
 *         name: email
 *         schema:
 *           type: string
 *         required: true
 *         description: Email of the user
 *     responses:
 *       200:
 *         description: Subscription status retrieved successfully
 *       400:
 *         description: Email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to get subscription status
 */

/**
 * @swagger
 * /api/stripe/debug-user/{email}:
 *   get:
 *     summary: Debug user data and Stripe customer information
 *     tags:
 *       - Stripe
 *     parameters:
 *       - in: path
 *         name: email
 *         schema:
 *           type: string
 *         required: true
 *         description: Email of the user
 *     responses:
 *       200:
 *         description: User and Stripe customer data retrieved successfully
 *       400:
 *         description: Email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to debug user
 */

/**
 * @swagger
 * /api/stripe/reset-user-premium/{email}:
 *   post:
 *     summary: Reset user premium status (for debugging purposes)
 *     tags:
 *       - Stripe
 *     parameters:
 *       - in: path
 *         name: email
 *         schema:
 *           type: string
 *         required: true
 *         description: Email of the user
 *     responses:
 *       200:
 *         description: User premium status reset successfully
 *       400:
 *         description: Email is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Failed to reset user premium status
 */

// Public: Stripe webhook must remain public
router.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  handleStripeWebhook
);

// Protected routes
router.post("/create-payment-intent", authenticateToken, createPaymentIntent);
router.post("/create-subscription", authenticateToken, createSubscription);
router.post("/cancel-subscription", authenticateToken, cancelSubscription);
router.get(
  "/subscription-status/:email",
  authenticateToken,
  getSubscriptionStatus
);
router.get("/debug-user/:email", authenticateToken, debugUser);
router.post("/reset-premium/:email", authenticateToken, resetUserPremium);
router.post("/buy-credits", authenticateToken, buyCreditsIntent);

export default router;

// hey there

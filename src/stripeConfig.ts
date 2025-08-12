import Stripe from 'stripe';

// Initialize Stripe with your secret key
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_51Rrjxd16JeMmx3ntRaA7YN9dNtja8BQkn1iiAhgptQtMPZ1YPEph1K5ew1N7sQ3dFvHX5gpRY3Tvxez7XqkTGXLK005pb2cAX8', {
  apiVersion: '2025-07-30.basil',
});

// Webhook endpoint secret for verifying webhook signatures
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_4cRagVGkMM0ouc1eDL4UMgt5z9Evcbi9';

// Product configurations - Replace with your actual price IDs from Stripe
export const STRIPE_PRODUCTS = {
  monthly: {
    priceId: 'price_1Rs1S916JeMmx3ntnSjVL6kW', // Replace with your actual monthly price ID
    name: 'MOSAIC Monthly Premium',
    price: 499, // $4.99 in cents
    interval: 'month'
  },
  // One-time add-on for 10 extra credits
  extraCredits10: {
    priceId: process.env.STRIPE_EXTRA_CREDITS_PRICE_ID || 'price_1RvLDv16JeMmx3ntv7vyMBFK',
    name: 'MOSAIC_Extra_Credits',
    credits: 10,
    amountCents: parseInt(process.env.EXTRA_CREDITS_AMOUNT_CENTS || '299', 10),
  },
};

export default stripe; 
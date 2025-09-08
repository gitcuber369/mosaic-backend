import Stripe from 'stripe';

// Initialize Stripe with your secret key
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string , {
  apiVersion: '2025-07-30.basil',
});

// Webhook endpoint secret for verifying webhook signatures
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

// Product configurations - Replace with your actual price IDs from Stripe
export const STRIPE_PRODUCTS = {
  monthly: {
    priceId: 'price_1Rs1S916JeMmx3ntnSjVL6kW', // Replace with your actual monthly price ID
    name: 'MOSAIC Monthly Premium', 
    price: 499, // $4.99 in cents
    interval: 'month'
  },
  credits10: {
    productId: 'prod_Sr3K7ubW5EPlTa',
    priceId: 'price_1RvLDv16JeMmx3ntv7vyMBFK',
    name: '10 Extra Listening Credits',
    price: 299, // $2.99 in cents
    credits: 10,
    type: 'one_time',
  },
};

export default stripe; 
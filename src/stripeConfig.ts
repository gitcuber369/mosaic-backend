console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY as string);
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
    priceId: 'price_1S5qq688oblFNHRFYP0AWISp', // Replace with your actual monthly price ID
    name: 'MOSAIC Monthly Premium', 
    price: 499, // $4.99 in cents
    interval: 'month'
  },
  credits10: {
    productId: 'prod_T1ugz4g83PNseG',
    priceId: 'price_1S5qqm88oblFNHRFnB3OujsH',
    name: '10 Extra Listening Credits',
    price: 299, // $2.99 in cents
    credits: 10,
    type: 'one_time',
  },
};

export default stripe; 
import { Request, Response } from 'express';
import { stripe, STRIPE_PRODUCTS } from '../stripeConfig';
import { getUsersCollection } from '../db';
import { ObjectId } from 'mongodb';

// Create a payment intent for subscription
export async function createPaymentIntent(req: Request, res: Response) {
  try {
    const { email, planType = 'monthly' } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const product = STRIPE_PRODUCTS[planType as keyof typeof STRIPE_PRODUCTS];
    if (!product) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    // Create or get customer
    const users = getUsersCollection();
    let user = await users.findOne({ email });
    
    let customerId: string;
    
    if (user?.stripeCustomerId) {
      console.log('Found existing stripeCustomerId:', user.stripeCustomerId);
      // Verify the customer still exists in Stripe
      try {
        await stripe.customers.retrieve(user.stripeCustomerId);
        customerId = user.stripeCustomerId;
        console.log('Customer exists in Stripe, using existing ID:', customerId);
      } catch (error) {
        console.log('Customer not found in Stripe, creating new one:', user.stripeCustomerId);
        console.log('Error details:', error);
        // Customer doesn't exist in Stripe, create a new one
        const customer = await stripe.customers.create({
          email,
          metadata: {
            userId: user._id?.toString() || ''
          }
        });
        
        customerId = customer.id;
        console.log('Created new customer:', customerId);
        
        // Update user with new Stripe customer ID
        await users.updateOne(
          { _id: user._id },
          { $set: { stripeCustomerId: customerId } }
        );
        console.log('Updated user with new customer ID');
      }
    } else {
      console.log('No existing stripeCustomerId, creating new customer');
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email,
        metadata: {
          userId: user?._id?.toString() || ''
        }
      });
      
      customerId = customer.id;
      console.log('Created new customer:', customerId);
      
      // Update user with Stripe customer ID
      if (user) {
        await users.updateOne(
          { _id: user._id },
          { $set: { stripeCustomerId: customerId } }
        );
        console.log('Updated user with new customer ID');
      }
    }

    console.log('Creating payment intent with customer:', customerId);
    // Create payment intent for immediate payment
    const paymentIntent = await stripe.paymentIntents.create({
      amount: product.price,
      currency: 'usd',
      customer: customerId,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        email,
        planType,
        priceId: product.priceId
      }
    });

    console.log('Payment intent created:', paymentIntent.id);
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      customerId
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    if (error instanceof Error) {
      res.status(500).json({ error: `Failed to create payment intent: ${error.message}` });
    } else {
      res.status(500).json({ error: 'Failed to create payment intent' });
    }
  }
}

// Create subscription after successful payment
export async function createSubscription(req: Request, res: Response) {
  try {
    const { email, paymentIntentId, planType = 'monthly' } = req.body;
    
    if (!email || !paymentIntentId) {
      return res.status(400).json({ error: 'Email and paymentIntentId are required' });
    }

    const product = STRIPE_PRODUCTS[planType as keyof typeof STRIPE_PRODUCTS];
    if (!product) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    // Get customer ID from user
    const users = getUsersCollection();
    const user = await users.findOne({ email });
    
    if (!user?.stripeCustomerId) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Verify the customer still exists in Stripe
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
    } catch (error) {
      console.log('Customer not found in Stripe during subscription creation:', user.stripeCustomerId);
      return res.status(404).json({ error: 'Stripe customer not found' });
    }

    // Retrieve the completed payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment intent not completed' });
    }

    // Create subscription using the customer and price with the payment method from the payment intent
    const subscription = await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: product.priceId }],
      default_payment_method: paymentIntent.payment_method as string,
      payment_settings: { save_default_payment_method: 'on_subscription' },
      metadata: {
        email,
        planType,
        paymentIntentId: paymentIntentId
      }
    });

    // Update user with subscription details
    await users.updateOne(
      { email },
      { 
        $set: { 
          isPremium: true,
          stripeSubscriptionId: subscription.id,
          premiumExpiresAt: new Date((subscription as any).current_period_end * 1000)
        }
      }
    );

    res.json({
      subscriptionId: subscription.id,
      success: true
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
}

// Handle Stripe webhook events
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'] as string;
  
  let event;
  
  // For development/testing, allow bypassing signature verification
  if (process.env.NODE_ENV === 'development' && !sig) {
    event = req.body;
  } else {
    if (!sig) {
      return res.status(400).json({ error: 'No signature provided' });
    }

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || 'whsec_your_webhook_secret_here'
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  try {
    const users = getUsersCollection();

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        const subscription = event.data.object as any;
        const email = subscription.metadata?.email;
        
        if (email && subscription.status === 'active') {
          await users.updateOne(
            { email },
            { 
              $set: { 
                isPremium: true,
                stripeSubscriptionId: subscription.id,
                premiumExpiresAt: new Date(subscription.current_period_end * 1000)
              }
            }
          );
        }
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object as any;
        const deletedEmail = deletedSubscription.metadata?.email;
        
        if (deletedEmail) {
          await users.updateOne(
            { email: deletedEmail },
            { 
              $set: { 
                isPremium: false
              },
              $unset: { 
                stripeSubscriptionId: "",
                premiumExpiresAt: ""
              }
            }
          );
        }
        break;

      case 'invoice.payment_failed':
        const invoice = event.data.object as any;
        const failedEmail = invoice.metadata?.email;
        
        if (failedEmail) {
          await users.updateOne(
            { email: failedEmail },
            { $set: { isPremium: false } }
          );
        }
        break;

      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object as any;
        const paymentEmail = paymentIntent.metadata?.email;
        
        if (paymentEmail && paymentIntent.metadata?.planType) {
          // Automatically create subscription when payment succeeds
          try {
            const product = STRIPE_PRODUCTS[paymentIntent.metadata.planType as keyof typeof STRIPE_PRODUCTS];
            if (product) {
              const user = await users.findOne({ email: paymentEmail });
              if (user?.stripeCustomerId) {
                const subscription = await stripe.subscriptions.create({
                  customer: user.stripeCustomerId,
                  items: [{ price: product.priceId }],
                  default_payment_method: paymentIntent.payment_method,
                  payment_settings: { save_default_payment_method: 'on_subscription' },
                  metadata: {
                    email: paymentEmail,
                    planType: paymentIntent.metadata.planType,
                    paymentIntentId: paymentIntent.id
                  }
                });

                await users.updateOne(
                  { email: paymentEmail },
                  { 
                    $set: { 
                      isPremium: true,
                      stripeSubscriptionId: subscription.id,
                      premiumExpiresAt: new Date((subscription as any).current_period_end * 1000)
                    }
                  }
                );
              }
            }
          } catch (error) {
            console.error('Error creating subscription from webhook:', error);
          }
        }
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// Cancel subscription
export async function cancelSubscription(req: Request, res: Response) {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });
    
    if (!user?.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Cancel subscription at period end
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true
    });

    res.json({ success: true, message: 'Subscription will be cancelled at the end of the current period' });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
}



// Get subscription status
// Debug route to check user data
export async function debugUser(req: Request, res: Response) {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if customer exists in Stripe
    let customerExists = false;
    let customerError = null;
    
    if (user.stripeCustomerId) {
      try {
        await stripe.customers.retrieve(user.stripeCustomerId);
        customerExists = true;
      } catch (error) {
        customerError = error instanceof Error ? error.message : 'Unknown error';
      }
    }

    res.json({
      user: {
        email: user.email,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
        isPremium: user.isPremium,
        premiumExpiresAt: user.premiumExpiresAt
      },
      stripeCustomerExists: customerExists,
      customerError: customerError
    });
  } catch (error) {
    console.error('Error debugging user:', error);
    res.status(500).json({ error: 'Failed to debug user' });
  }
}

export async function getSubscriptionStatus(req: Request, res: Response) {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let subscription = null;
    if (user.stripeSubscriptionId) {
      try {
        subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      } catch (error) {
        console.error('Error retrieving subscription:', error);
      }
    }

    res.json({
      isPremium: user.isPremium || false,
      subscription,
      premiumExpiresAt: user.premiumExpiresAt
    });
  } catch (error) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
} 
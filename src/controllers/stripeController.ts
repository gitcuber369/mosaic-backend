import { Request, Response } from "express";
import { getUsersCollection } from "../db";
import {
  stripe,
  STRIPE_PRODUCTS,
  STRIPE_WEBHOOK_SECRET,
} from "../stripeConfig";

// One-time purchase of 10 credits
export async function buyCreditsIntent(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const users = getUsersCollection();
    let user = await users.findOne({ email });
    let customerId: string;
    if (user?.stripeCustomerId) {
      customerId = user.stripeCustomerId;
    } else {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email,
        metadata: { userId: user?._id?.toString() || "" },
      });
      customerId = customer.id;
      if (user) {
        await users.updateOne(
          { _id: user._id },
          { $set: { stripeCustomerId: customerId } }
        );
      }
    }
    // Create PaymentIntent for one-time credits purchase
    const product = STRIPE_PRODUCTS.credits10;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: product.price,
      currency: "usd",
      customer: customerId,
      payment_method_types: ["card"],
      metadata: {
        email,
        product: "credits10",
        credits: product.credits.toString(),
      },
    });
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error creating buy credits intent:", error);
    res.status(500).json({ error: "Failed to create buy credits intent" });
  }
}

// Utility: Increase storyListenCredits by N for a user
async function addStoryListenCredits(
  email: string,
  credits: number = 10
): Promise<{ success: boolean; user?: any; error?: any }> {
  try {
    if (!email) return { success: false, error: "Email is required" };
    const users = getUsersCollection();
    const result = await users.findOneAndUpdate(
      { email },
      { $inc: { storyListenCredits: credits } },
      { returnDocument: "after" }
    );
    if (!result || !("value" in result) || !result.value) {
      return { success: false, error: "User not found" };
    }
    return { success: true, user: result.value };
  } catch (error) {
    return { success: false, error };
  }
}

// Create a setup intent for subscription
export async function createPaymentIntent(req: Request, res: Response) {
  try {
    const { email, planType = "monthly" } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const product = STRIPE_PRODUCTS[planType as keyof typeof STRIPE_PRODUCTS];
    if (!product) {
      return res.status(400).json({ error: "Invalid plan type" });
    }

    // Create or get customer
    const users = getUsersCollection();
    let user = await users.findOne({ email });

    let customerId: string;

    if (user?.stripeCustomerId) {
      console.log("Found existing stripeCustomerId:", user.stripeCustomerId);
      // Verify the customer still exists in Stripe
      try {
        await stripe.customers.retrieve(user.stripeCustomerId);
        customerId = user.stripeCustomerId;
        console.log(
          "Customer exists in Stripe, using existing ID:",
          customerId
        );
      } catch (error) {
        console.log(
          "Customer not found in Stripe, creating new one:",
          user.stripeCustomerId
        );
        console.log("Error details:", error);
        // Customer doesn't exist in Stripe, create a new one
        const customer = await stripe.customers.create({
          email,
          metadata: {
            userId: user._id?.toString() || "",
          },
        });

        customerId = customer.id;
        console.log("Created new customer:", customerId);

        // Update user with new Stripe customer ID
        await users.updateOne(
          { _id: user._id },
          { $set: { stripeCustomerId: customerId } }
        );
        console.log("Updated user with new customer ID");
      }
    } else {
      console.log("No existing stripeCustomerId, creating new customer");
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email,
        metadata: {
          userId: user?._id?.toString() || "",
        },
      });

      customerId = customer.id;
      console.log("Created new customer:", customerId);

      // Update user with Stripe customer ID
      if (user) {
        await users.updateOne(
          { _id: user._id },
          { $set: { stripeCustomerId: customerId } }
        );
        console.log("Updated user with new customer ID");
      }
    }

    console.log("Creating payment intent with customer:", customerId);
    // Create setup intent for subscription
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: {
        email,
        planType,
        priceId: product.priceId,
      },
    });

    console.log("Setup intent created:", setupIntent.id);

    res.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    if (error instanceof Error) {
      res
        .status(500)
        .json({ error: `Failed to create payment intent: ${error.message}` });
    } else {
      res.status(500).json({ error: "Failed to create payment intent" });
    }
  }
}

// Create subscription after successful setup intent
export async function createSubscription(req: Request, res: Response) {
  try {
    const { email, setupIntentId, planType = "monthly" } = req.body;

    if (!email || !setupIntentId) {
      return res
        .status(400)
        .json({ error: "Email and setupIntentId are required" });
    }

    const product = STRIPE_PRODUCTS[planType as keyof typeof STRIPE_PRODUCTS];
    if (!product) {
      return res.status(400).json({ error: "Invalid plan type" });
    }

    // Get customer ID from user
    const users = getUsersCollection();
    const user = await users.findOne({ email });

    if (!user?.stripeCustomerId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Verify the customer still exists in Stripe
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
    } catch (error) {
      console.log(
        "Customer not found in Stripe during subscription creation:",
        user.stripeCustomerId
      );
      return res.status(404).json({ error: "Stripe customer not found" });
    }

    // Retrieve the completed setup intent
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

    if (setupIntent.status !== "succeeded") {
      return res.status(400).json({ error: "Setup intent not completed" });
    }

    // Create subscription using the customer and price with the payment method from the setup intent
    const subscription = await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: product.priceId }],
      default_payment_method: setupIntent.payment_method as string,
      payment_settings: { save_default_payment_method: "on_subscription" },
      metadata: {
        email,
        planType,
        setupIntentId: setupIntentId,
      },
    });

    // Update user with subscription details (credits will be added via webhook)
    const userBefore = await users.findOne({ email });
    await users.updateOne(
      { email },
      {
        $set: {
          isPremium: true,
          stripeSubscriptionId: subscription.id,
          premiumExpiresAt: new Date(
            (subscription as any).current_period_end * 1000
          ),
          storyListenCredits: (userBefore?.tokens || 0) + 30,
        },
      }
    );

    res.json({
      subscriptionId: subscription.id,
      success: true,
    });
  } catch (error) {
    console.error("Error creating subscription:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
}

// Handle Stripe webhook events
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;

  let event;

  // For development/testing, allow bypassing signature verification
  if (process.env.NODE_ENV === "development" && !sig) {
    event = req.body;
  } else {
    if (!sig) {
      return res.status(400).json({ error: "No signature provided" });
    }

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      console.error("Webhook secret being used:", STRIPE_WEBHOOK_SECRET);
      console.error("Signature header:", sig);
      return res.status(400).json({ error: "Invalid signature" });
    }
  }

  try {
    const users = getUsersCollection();

    switch (event.type) {
      // Handle successful one-time payment for credits10
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as any;
        const email = paymentIntent.metadata?.email;
        const product = paymentIntent.metadata?.product;
        const credits = parseInt(paymentIntent.metadata?.credits || "0", 10);
        if (email && product === "credits10" && credits > 0) {
          try {
            // Log user before update
            const userBefore = await users.findOne({ email });
            console.log(
              "[Stripe Webhook] [payment_intent.succeeded] User before update:",
              userBefore
            );
            const result = await users.updateOne(
              { email },
              { $inc: { storyListenCredits: 10 } }
            );
            // Log update result
            console.log(
              "[Stripe Webhook] [payment_intent.succeeded] updateOne result:",
              result
            );
            // Log user after update
            const userAfter = await users.findOne({ email });
            console.log(
              "[Stripe Webhook] [payment_intent.succeeded] User after update:",
              userAfter
            );
            if (result.modifiedCount === 1) {
              console.log(
                `Granted ${credits} credits to ${email} for one-time purchase.`
              );
            } else {
              throw new Error("User not found or credits not updated");
            }
          } catch (err) {
            console.error(
              `Failed to grant credits to ${email}:`,
              err
            );
          }
        }
        break;
      }
      case "customer.subscription.created": {
        const newSubscription = event.data.object as any;
        const newEmail = newSubscription.metadata?.email;
        console.log(
          "[Stripe Webhook] Received customer.subscription.created event"
        );
        console.log("[Stripe Webhook] newEmail:", newEmail);
        console.log(
          "[Stripe Webhook] newSubscription.status:",
          newSubscription.status
        );
        if (newEmail && newSubscription.status === "active") {
          try {
            // Log user before update
            const userBefore = await users.findOne({ email: newEmail });
            console.log("[Stripe Webhook] User before update:", userBefore);
            const result = await users.updateOne(
              { email: newEmail },
              {
                $set: {
                  isPremium: true,
                  storyListenCredits:
                    (userBefore?.storyListenCredits || 0) + 30,
                  stripeSubscriptionId: newSubscription.id,
                  premiumExpiresAt: new Date(
                    newSubscription.current_period_end * 1000
                  ),
                },
                $inc: {
                  storyListenCredits: 30,
                },
              }
            );
            // Log update result
            console.log("[Stripe Webhook] updateOne result:", result);
            // Log user after update
            const userAfter = await users.findOne({ email: newEmail });
            console.log("[Stripe Webhook] User after update:", userAfter);
            if (result.modifiedCount === 1) {
              console.log(`Granted subscription and credits to ${newEmail}`);
            } else {
              throw new Error("User not found or subscription not updated");
            }
          } catch (err) {
            console.error(
              `Failed to update subscription for ${newEmail}:`,
              err
            );
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const updatedSubscription = event.data.object as any;
        const updatedEmail = updatedSubscription.metadata?.email;

        if (updatedEmail && updatedSubscription.status === "active") {
          // Check if this is a renewal (previous_period_end exists and is different)
          const user = await users.findOne({ email: updatedEmail });
          if (user?.premiumExpiresAt) {
            const previousExpiry = new Date(user.premiumExpiresAt);
            const newExpiry = new Date(
              updatedSubscription.current_period_end * 1000
            );

            // If the expiry date has increased, it's a renewal
            if (newExpiry > previousExpiry) {
              try {
                const result = await users.updateOne(
                  { email: updatedEmail },
                  {
                    $set: {
                      isPremium: true,
                      stripeSubscriptionId: updatedSubscription.id,
                      premiumExpiresAt: new Date(
                        updatedSubscription.current_period_end * 1000
                      ),
                    },
                    $inc: {
                      storyListenCredits: 30,
                    },
                  }
                );
                if (result.modifiedCount === 1) {
                  console.log(
                    `Renewed subscription and granted credits to ${updatedEmail}`
                  );
                } else {
                  throw new Error("User not found or renewal not updated");
                }
              } catch (err) {
                console.error(
                  `Failed to update renewal for ${updatedEmail}:`,
                  err
                );
              }
            } else {
              // Just update the subscription details without adding credits
              try {
                const result = await users.updateOne(
                  { email: updatedEmail },
                  {
                    $set: {
                      isPremium: true,
                      stripeSubscriptionId: updatedSubscription.id,
                      premiumExpiresAt: new Date(
                        updatedSubscription.current_period_end * 1000
                      ),
                    },
                  }
                );
                if (result.modifiedCount === 1) {
                  console.log(
                    `Updated subscription details for ${updatedEmail}`
                  );
                } else {
                  throw new Error("User not found or details not updated");
                }
              } catch (err) {
                console.error(
                  `Failed to update subscription details for ${updatedEmail}:`,
                  err
                );
              }
            }
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const deletedSubscription = event.data.object as any;
        const deletedEmail = deletedSubscription.metadata?.email;

        if (deletedEmail) {
          try {
            const result = await users.updateOne(
              { email: deletedEmail },
              {
                $set: {
                  isPremium: false,
                },
                $unset: {
                  stripeSubscriptionId: "",
                  premiumExpiresAt: "",
                },
              }
            );
            if (result.modifiedCount === 1) {
              console.log(`Subscription deleted for ${deletedEmail}`);
            } else {
              throw new Error("User not found or subscription not deleted");
            }
          } catch (err) {
            console.error(
              `Failed to delete subscription for ${deletedEmail}:`,
              err
            );
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        const failedEmail = invoice.metadata?.email;

        if (failedEmail) {
          try {
            const result = await users.updateOne(
              { email: failedEmail },
              { $set: { isPremium: false } }
            );
            if (result.modifiedCount === 1) {
              console.log(
                `Set isPremium false for ${failedEmail} after payment failed`
              );
            } else {
              throw new Error("User not found or isPremium not updated");
            }
          } catch (err) {
            console.error(
              `Failed to update isPremium for ${failedEmail}:`,
              err
            );
          }
        }
        break;
      }

      case "setup_intent.succeeded": {
        const setupIntent = event.data.object as any;
        const setupEmail = setupIntent.metadata?.email;

        if (setupEmail && setupIntent.metadata?.planType) {
          // Automatically create subscription when setup succeeds
          try {
            const product =
              STRIPE_PRODUCTS[
                setupIntent.metadata.planType as keyof typeof STRIPE_PRODUCTS
              ];
            if (product) {
              const user = await users.findOne({ email: setupEmail });
              if (user?.stripeCustomerId) {
                // The payment method is already attached to the customer via setup intent
                const subscription = await stripe.subscriptions.create({
                  customer: user.stripeCustomerId,
                  items: [{ price: product.priceId }],
                  default_payment_method: setupIntent.payment_method,
                  payment_settings: {
                    save_default_payment_method: "on_subscription",
                  },
                  metadata: {
                    email: setupEmail,
                    planType: setupIntent.metadata.planType,
                    setupIntentId: setupIntent.id,
                  },
                });

                try {
                  const result = await users.updateOne(
                    { email: setupEmail },
                    {
                      $set: {
                        isPremium: true,
                        stripeSubscriptionId: subscription.id,
                        premiumExpiresAt: new Date(
                          (subscription as any).current_period_end * 1000
                        ),
                      },
                      $inc: {
                        storyListenCredits: 30,
                      },
                    }
                  );
                  if (result.modifiedCount === 1) {
                    console.log(
                      "Subscription created successfully:",
                      subscription.id
                    );
                  } else {
                    throw new Error(
                      "User not found or subscription not updated"
                    );
                  }
                } catch (err) {
                  console.error(
                    `Failed to create subscription for ${setupEmail}:`,
                    err
                  );
                }
              }
            }
          } catch (error) {
            console.error("Error creating subscription from webhook:", error);
            console.error("Setup Intent ID:", setupIntent.id);
            console.error("Payment Method ID:", setupIntent.payment_method);
            const user = await users.findOne({ email: setupEmail });
            console.error("Customer ID:", user?.stripeCustomerId);
          }
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

// Cancel subscription
export async function cancelSubscription(req: Request, res: Response) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });

    if (!user?.stripeSubscriptionId) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    // Cancel subscription at period end
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    res.json({
      success: true,
      message:
        "Subscription will be cancelled at the end of the current period",
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
}

// Get subscription status
// Debug route to check user data
export async function debugUser(req: Request, res: Response) {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if customer exists in Stripe
    let customerExists = false;
    let customerError = null;

    if (user.stripeCustomerId) {
      try {
        await stripe.customers.retrieve(user.stripeCustomerId);
        customerExists = true;
      } catch (error) {
        customerError =
          error instanceof Error ? error.message : "Unknown error";
      }
    }

    res.json({
      user: {
        email: user.email,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
        isPremium: user.isPremium,
        premiumExpiresAt: user.premiumExpiresAt,
      },
      stripeCustomerExists: customerExists,
      customerError: customerError,
    });
  } catch (error) {
    console.error("Error debugging user:", error);
    res.status(500).json({ error: "Failed to debug user" });
  }
}

// Reset user premium status (for debugging)
export async function resetUserPremium(req: Request, res: Response) {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Reset premium status
    await users.updateOne(
      { email },
      {
        $set: {
          isPremium: false,
        },
        $unset: {
          premiumExpiresAt: "",
          stripeSubscriptionId: "",
        },
      }
    );

    res.json({
      message: "User premium status reset successfully",
      email: email,
    });
  } catch (error) {
    console.error("Error resetting user premium:", error);
    res.status(500).json({ error: "Failed to reset user premium" });
  }
}

export async function getSubscriptionStatus(req: Request, res: Response) {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const users = getUsersCollection();
    const user = await users.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let subscription = null;
    if (user.stripeSubscriptionId) {
      try {
        subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId
        );
      } catch (error) {
        console.error("Error retrieving subscription:", error);
      }
    }

    res.json({
      isPremium: user.isPremium || false,
      subscription,
      premiumExpiresAt: user.premiumExpiresAt,
    });
  } catch (error) {
    console.error("Error getting subscription status:", error);
    res.status(500).json({ error: "Failed to get subscription status" });
  }
}

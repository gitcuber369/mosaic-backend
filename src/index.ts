import dotenv from "dotenv";
dotenv.config();

// Set NODE_ENV to development if not set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}

import express, { json, raw } from "express";
import { connectToDatabase } from "./db";
import FirebaseAnalytics from "./firebaseConfig";
import {
  analyticsMiddleware,
  errorAnalyticsMiddleware,
} from "./middleware/analytics";
import elevenlabsRouter from "./routes/elevenlabs";
import exampleRouter from "./routes/example";
import geminiRouter from "./routes/gemini";
import revenuecatRouter from "./routes/revenuecat";
import appstoreRouter from "./routes/appstore";
import storiesRouter from "./routes/stories";
import stripeRouter from "./routes/stripe";
import supportRouter from "./routes/support";
import usersRouter from "./routes/users";
// @ts-ignore
import swaggerUi from "swagger-ui-express";

import { specs } from "./swaggerConfig";

const app = express();
const PORT = process.env.PORT;

// --- Stripe webhook raw body parser ---
app.use("/api/stripe/webhook", raw({ type: "application/json" }));
// --- End Stripe raw body parser ---

// --- RevenueCat webhook raw body parser ---
app.use("/api/revenuecat/webhook", raw({ type: "application/json" }));
// --- End RevenueCat raw body parser ---

app.use(json());

// Analytics middleware - track all API requests
app.use(analyticsMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Test Firebase Analytics endpoint
app.get("/test-firebase", async (_req, res) => {
  try {
    const isConnected = await FirebaseAnalytics.testConnection();
    if (isConnected) {
      await FirebaseAnalytics.trackEvent("firebase_test", {
        timestamp: new Date().toISOString(),
        source: "test_endpoint",
      });
      res.json({
        status: "success",
        message: "Firebase Analytics is working!",
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    } else {
      res.status(500).json({
        status: "error",
        message: "Firebase Analytics connection failed",
      });
    }
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Firebase test failed",
      error: (error as Error).message,
    });
  }
});

app.use("/api/users", usersRouter);
app.use("/api/example", exampleRouter);
app.use("/api/gemini", geminiRouter);
app.use("/api/stories", storiesRouter);
app.use("/api/elevenlabs", elevenlabsRouter);
app.use("/api/support", supportRouter);
app.use("/api/stripe", stripeRouter);
app.use("/api/revenuecat", revenuecatRouter);
app.use('/api/app-store', appstoreRouter);

// Serve Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// Error analytics middleware - should be after routes
app.use(errorAnalyticsMiddleware);

connectToDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  });

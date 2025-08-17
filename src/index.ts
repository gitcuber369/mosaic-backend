import dotenv from 'dotenv';
dotenv.config();

// Set NODE_ENV to development if not set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

import express from 'express';
import { json, raw } from 'express';
import usersRouter from './routes/users';
import exampleRouter from './routes/example';
import geminiRouter from './routes/gemini';
import storiesRouter from './routes/stories';
import elevenlabsRouter from './routes/elevenlabs';
import supportRouter from './routes/support';
import stripeRouter from './routes/stripe';
import { connectToDatabase } from './db';
// @ts-ignore
import { swaggerUi, specs } from './swaggerConfig';

const app = express();
const PORT = process.env.PORT || 3001;

// --- Stripe webhook raw body parser ---
app.use('/api/stripe/webhook', raw({ type: 'application/json' }));
// --- End Stripe raw body parser ---

app.use(json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/users', usersRouter);
app.use('/api/example', exampleRouter)
app.use('/api/gemini', geminiRouter);
app.use('/api/stories', storiesRouter);
app.use('/api/elevenlabs', elevenlabsRouter);
app.use('/api/support', supportRouter);
app.use('/api/stripe', stripeRouter);

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

connectToDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { json, raw } from 'express';
import usersRouter from './routes/users';
import exampleRouter from './routes/example';
import geminiRouter from './routes/gemini';
import storiesRouter from './routes/stories';
import elevenlabsRouter from './routes/elevenlabs';
import supportRouter from './routes/support';
import { connectToDatabase } from './db';

const app = express();
const PORT = process.env.PORT || 3001;

// --- RevenueCat webhook raw body parser ---
app.use('/api/users/revenuecat-webhook', raw({ type: '*/*' }));
// --- End RevenueCat raw body parser ---

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
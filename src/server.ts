import 'dotenv/config';
import express from 'express';
import licenseRouter from './routes/license';
import stripeRouter, { stripeWebhookHandler } from './routes/stripe';
import { stripeRawBodyMiddleware } from './middleware/rawBody';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Stripe webhook must read the untouched raw body for signature verification.
app.post('/stripe/webhook', stripeRawBodyMiddleware, stripeWebhookHandler);

app.use(express.json());

app.use('/license', licenseRouter);
app.use('/stripe', stripeRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

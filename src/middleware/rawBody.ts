import express from 'express';

export const stripeRawBodyMiddleware = express.raw({ type: 'application/json' });

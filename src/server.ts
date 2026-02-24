import express from "express";
import cors from "cors";
import licenseRouter from "./routes/license";
import stripeRouter, { stripeWebhookHandler } from "./routes/stripe";

import rateLimit from "express-rate-limit";

const app = express();

// Rate limit /license/verify (key + IP)
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 requests/min per (key+ip)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const key = typeof req.body?.key === "string" ? req.body.key : "no-key";
    return `${req.ip}:${key}`;
  },
  message: { active: false, reason: "RATE_LIMITED" },
});

// Apply only to the verify endpoint
app.use("/license/verify", express.json(), verifyLimiter);



// 1) Stripe webhook MUST stay raw
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// 2) JSON parser for everything else
app.use(express.json());

// 3) CORS
// - /license is called from customer sites (any origin)
// - /stripe endpoints should NOT be public unless you explicitly want them
app.use(
  "/license",
  cors({
    origin: true, // reflect request origin
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }) 
);

// If you have public marketing pages calling /stripe/request-otp or /stripe/portal-session,
// you can allow only your own domain(s) here (recommended):
app.use(
  "/stripe",
  cors({
    origin: (origin, cb) => {
      // allow non-browser calls (no origin) and your site domains only
      const allowed = new Set([
        "https://squarepro.co.uk",
        "https://www.squarepro.co.uk",
        "https://onwards-upwards.squarespace.com",
        "https://ou.studio"
      ]);
      if (!origin || allowed.has(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["POST", "GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-admin-token"],
  })
);

app.use("/license", licenseRouter);
app.use("/stripe", stripeRouter);

export default app;
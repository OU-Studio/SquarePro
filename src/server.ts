import express from "express";
import cors from "cors";
import licenseRouter from "./routes/license";
import stripeRouter, { stripeWebhookHandler } from "./routes/stripe";

const app = express();

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
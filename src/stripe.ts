import { Router } from "express";
import { prisma } from "./prisma"; // adjust to your prisma client path
import { generate6DigitCode, hashCode } from "./otp";
import { sendOtpEmail } from "./mailer";

const router = Router();

// POST /stripe/request-otp
router.post("/request-otp", async (req, res) => {
  try {
    const emailRaw = String(req.body?.customerEmail || "").trim().toLowerCase();
    if (!emailRaw || !emailRaw.includes("@")) {
      return res.status(400).json({ ok: false, reason: "INVALID_EMAIL" });
    }

    const code = generate6DigitCode();
    const codeHash = hashCode(emailRaw, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate previous unused OTPs for this email (optional)
    await prisma.emailOtp.updateMany({
      where: { email: emailRaw, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    await prisma.emailOtp.create({
      data: { email: emailRaw, codeHash, expiresAt },
    });

    await sendOtpEmail(emailRaw, code);

    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR" });
  }
});

// POST /stripe/portal-session
router.post("/portal-session", async (req, res) => {
  try {
    const licenseKey = req.body?.licenseKey ? String(req.body.licenseKey).trim() : "";
    const customerEmail = req.body?.customerEmail ? String(req.body.customerEmail).trim().toLowerCase() : "";
    const code = req.body?.code ? String(req.body.code).trim() : "";

    let stripeCustomerId: string | null = null;

    // Preferred: licenseKey path (no OTP needed)
    if (licenseKey) {
      const lic = await prisma.license.findUnique({ where: { licenseKey } });
      if (!lic?.stripeCustomerId) {
        return res.status(404).json({ ok: false, reason: "LICENSE_NOT_FOUND" });
      }
      stripeCustomerId = lic.stripeCustomerId;
    } else {
      // Email + OTP path
      if (!customerEmail || !code) {
        return res.status(400).json({ ok: false, reason: "MISSING_EMAIL_OR_CODE" });
      }

      const codeHash = hashCode(customerEmail, code);

      const otp = await prisma.emailOtp.findFirst({
        where: {
          email: customerEmail,
          codeHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otp) {
        return res.status(401).json({ ok: false, reason: "INVALID_OTP" });
      }

      // mark used
      await prisma.emailOtp.update({
        where: { id: otp.id },
        data: { usedAt: new Date() },
      });

      // Find Stripe customer by email (safe now because OTP proves control)
      const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });
      const customer = customers.data[0];
      if (!customer) {
        return res.status(404).json({ ok: false, reason: "CUSTOMER_NOT_FOUND" });
      }
      stripeCustomerId = customer.id;
    }

    const returnUrl = process.env.APP_BASE_URL || "https://squarepro.co.uk";

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return res.json({ ok: true, url: session.url });
  } catch (e: any) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR" });
  }
});

export default router;
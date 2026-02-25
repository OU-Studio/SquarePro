import { LicenseStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Request, Response, Router } from 'express';
import { prisma } from '../prisma';
import { stripe } from "../stripe";
import { generate6DigitCode, hashCode } from "../otp";
import { sendOtpEmail, sendLicenseKeyEmail } from "../mailer";

const router = Router();

const mapStripeSubscriptionStatus = (
  status: string | null | undefined,
): LicenseStatus => {
  switch (status) {
    case 'active':
      return LicenseStatus.ACTIVE;
    case 'trialing':
      return LicenseStatus.TRIALING;
    case 'past_due':
      return LicenseStatus.PAST_DUE;
    case 'canceled':
    case 'unpaid':
      return LicenseStatus.CANCELED;
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
    default:
      return LicenseStatus.INCOMPLETE;
  }
};

async function deliverKeyIfNeeded(licenseId: string, to: string, licenseKey: string) {
  const fresh = await prisma.license.findUnique({ where: { id: licenseId } });
  if (!fresh || fresh.keySentAt) return;

  await sendLicenseKeyEmail(to, licenseKey);

  await prisma.license.update({
    where: { id: licenseId },
    data: { keySentAt: new Date() },
  });
}

const generateLicenseKey = (): string => `SPRO_${randomBytes(24).toString('base64url')}`;

const ensureLicenseForSubscription = async (params: {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: LicenseStatus;
  customerEmail?: string | null;
}) => {
  const existing = await prisma.license.findUnique({
    where: { stripeSubscriptionId: params.stripeSubscriptionId },
  });

  if (existing) {
    return prisma.license.update({
      where: { id: existing.id },
      data: {
        stripeCustomerId: params.stripeCustomerId,
        status: params.status,
        customerEmail: existing.customerEmail ?? (params.customerEmail || null),
      },
    });
  }

  for (;;) {
    try {
      return await prisma.license.create({
        data: {
          licenseKey: generateLicenseKey(),
          stripeCustomerId: params.stripeCustomerId,
          stripeSubscriptionId: params.stripeSubscriptionId,
          status: params.status,
          customerEmail: params.customerEmail || null,
        },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        const raceWinner = await prisma.license.findUnique({
          where: { stripeSubscriptionId: params.stripeSubscriptionId },
        });

        if (raceWinner) {
          return prisma.license.update({
            where: { id: raceWinner.id },
            data: {
              stripeCustomerId: params.stripeCustomerId,
              status: params.status,
              customerEmail: raceWinner.customerEmail ?? (params.customerEmail || null),
            },
          });
        }

        continue;
      }
      throw error;
    }
  }
};

const handleCheckoutCompleted = async (event: any): Promise<void> => {
  const session = event.data.object as any;

  const subscriptionId: string | null | undefined = session.subscription;
  const customerId: string | null | undefined = session.customer;

  // Stripe can provide email in a couple places:
  const email: string | null =
    session.customer_details?.email ||
    session.customer_email ||
    null;

  if (!subscriptionId || !customerId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await ensureLicenseForSubscription({
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    status: mapStripeSubscriptionStatus(subscription.status),
    customerEmail: email,
  });
};

const upsertFromSubscriptionObject = async (subscription: {
  id: string;
  customer: string | { id: string };
  status: string;
}): Promise<void> => {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // fetch email from Stripe customer
  let email: string | null = null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && typeof customer === "object" && !("deleted" in customer)) {
      email = customer.email || null;
    }
  } catch {
    // ignore; email is optional
  }

  const license = await ensureLicenseForSubscription({
  stripeSubscriptionId: subscription.id,
  stripeCustomerId: customerId,
  status: mapStripeSubscriptionStatus(subscription.status),
  customerEmail: email,
});

if (email) {
  await deliverKeyIfNeeded(license.id, email, license.licenseKey);
}
};

const handleInvoicePaid = async (event: any): Promise<void> => {
  const invoice = event.data.object as { subscription?: string | null };
  if (!invoice.subscription) {
    return;
  }

  await prisma.license.updateMany({
    where: { stripeSubscriptionId: invoice.subscription },
    data: { status: LicenseStatus.ACTIVE },
  });
};

const handleInvoicePaymentFailed = async (event: any): Promise<void> => {
  const invoice = event.data.object as { subscription?: string | null };
  if (!invoice.subscription) {
    return;
  }

  await prisma.license.updateMany({
    where: { stripeSubscriptionId: invoice.subscription },
    data: { status: LicenseStatus.PAST_DUE },
  });
};

export const stripeWebhookHandler = async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];

  if (!process.env.STRIPE_WEBHOOK_SECRET || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await upsertFromSubscriptionObject(event.data.object);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event);
        break;
      default:
        break;
    }

    return res.json({ received: true });
  } catch {
    return res.status(200).json({ received: true });
  }
};

router.post("/portal-session", async (req, res) => {
  try {
    const licenseKey = String(req.body?.licenseKey || "").trim();
    const code = String(req.body?.code || "").trim();

    if (!licenseKey) return res.status(400).json({ ok: false, reason: "MISSING_LICENSE_KEY" });
    if (!code) return res.status(400).json({ ok: false, reason: "MISSING_OTP" });

    const lic = await prisma.license.findUnique({ where: { licenseKey } });
    if (!lic) return res.status(404).json({ ok: false, reason: "INVALID_KEY" });

    const email = (lic.customerEmail || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, reason: "NO_EMAIL_ON_FILE" });

    const codeHash = hashCode(email, code);

    const otp = await prisma.emailOtp.findFirst({
      where: {
        email,
        codeHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) return res.status(401).json({ ok: false, reason: "INVALID_OTP" });

    await prisma.emailOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    if (!lic.stripeCustomerId) {
      return res.status(404).json({ ok: false, reason: "CUSTOMER_NOT_FOUND" });
    }

    const returnUrl = process.env.APP_BASE_URL || "https://squarepro.co.uk";

    const session = await stripe.billingPortal.sessions.create({
      customer: lic.stripeCustomerId,
      return_url: returnUrl,
    });

    return res.json({ ok: true, url: session.url });
  } catch {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR" });
  }
});

router.get('/license/by-subscription/:subscriptionId', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.header('x-admin-token') !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const license = await prisma.license.findUnique({
      where: { stripeSubscriptionId: req.params.subscriptionId },
      include: { domains: { orderBy: { createdAt: 'asc' } } },
    });

    if (!license) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json({
      licenseKey: license.licenseKey,
      status: license.status,
      boundDomains: license.domains.map((d) => d.hostname),
    });
  } catch {
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

router.post("/request-otp", async (req, res) => {
  try {
    const licenseKey = String(req.body?.licenseKey || "").trim();
    console.log("[request-otp] start", { licenseKey });
    if (!licenseKey) {
      return res.status(400).json({ ok: false, reason: "MISSING_LICENSE_KEY" });
    }

    const lic = await prisma.license.findUnique({ where: { licenseKey } });
    if (!lic) return res.status(404).json({ ok: false, reason: "INVALID_KEY" });

    // Must have email on file (set by checkout webhook)
    const emailRaw = (lic.customerEmail || "").trim().toLowerCase();
    if (!emailRaw || !emailRaw.includes("@")) {
      return res.status(400).json({ ok: false, reason: "NO_EMAIL_ON_FILE" });
    }

    const code = generate6DigitCode();
    const codeHash = hashCode(emailRaw, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log("[request-otp] sending email to", emailRaw);

    console.log("[request-otp] invalidate start");
await prisma.emailOtp.updateMany({
  where: { email: emailRaw, usedAt: null, expiresAt: { gt: new Date() } },
  data: { usedAt: new Date() },
});
console.log("[request-otp] invalidate done");

console.log("[request-otp] create start");
await prisma.emailOtp.create({
  data: { email: emailRaw, codeHash, expiresAt },
});
console.log("[request-otp] create done");

console.log("[request-otp] send start");
await sendOtpEmail(emailRaw, code);
    console.log("[request-otp] email sent");
    return res.json({ ok: true });
  } catch (e: any) {
    console.error("[request-otp] ERROR", e?.message || e, e?.stack || "");
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR" });
  }
});

export default router;

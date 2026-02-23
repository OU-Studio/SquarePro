import { LicenseStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Request, Response, Router } from 'express';
import { prisma } from '../prisma';
import { STRIPE_WEBHOOK_SECRET, stripe } from '../stripe';

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

const generateLicenseKey = (): string => `SPRO_${randomBytes(24).toString('base64url')}`;

const ensureLicenseForSubscription = async (params: {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: LicenseStatus;
}): Promise<void> => {
  const existing = await prisma.license.findUnique({
    where: { stripeSubscriptionId: params.stripeSubscriptionId },
  });

  if (existing) {
    await prisma.license.update({
      where: { id: existing.id },
      data: {
        stripeCustomerId: params.stripeCustomerId,
        status: params.status,
      },
    });
    return;
  }

  for (;;) {
    try {
      await prisma.license.create({
        data: {
          licenseKey: generateLicenseKey(),
          stripeCustomerId: params.stripeCustomerId,
          stripeSubscriptionId: params.stripeSubscriptionId,
          status: params.status,
        },
      });
      return;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        const raceWinner = await prisma.license.findUnique({
          where: { stripeSubscriptionId: params.stripeSubscriptionId },
        });

        if (raceWinner) {
          await prisma.license.update({
            where: { id: raceWinner.id },
            data: {
              stripeCustomerId: params.stripeCustomerId,
              status: params.status,
            },
          });
          return;
        }

        continue;
      }
      throw error;
    }
  }
};

const handleCheckoutCompleted = async (event: any): Promise<void> => {
  const session = event.data.object as {
    subscription?: string | null;
    customer?: string | null;
  };

  if (!session.subscription || !session.customer) {
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  await ensureLicenseForSubscription({
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: session.customer,
    status: mapStripeSubscriptionStatus(subscription.status),
  });
};

const upsertFromSubscriptionObject = async (subscription: {
  id: string;
  customer: string | { id: string };
  status: string;
}): Promise<void> => {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  await ensureLicenseForSubscription({
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    status: mapStripeSubscriptionStatus(subscription.status),
  });
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

  if (!STRIPE_WEBHOOK_SECRET || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      STRIPE_WEBHOOK_SECRET,
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

router.post('/portal-session', async (req: Request, res: Response) => {
  try {
    const licenseKey =
      typeof req.body?.licenseKey === 'string' ? req.body.licenseKey.trim() : '';
    const customerEmail =
      typeof req.body?.customerEmail === 'string'
        ? req.body.customerEmail.trim().toLowerCase()
        : '';

    let customerId = '';

    if (licenseKey) {
      const license = await prisma.license.findUnique({
        where: { licenseKey },
      });
      if (license?.stripeCustomerId) {
        customerId = license.stripeCustomerId;
      }
    }

    if (!customerId && customerEmail) {
      const customers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });
      const first = customers.data[0];
      if (first?.id) {
        customerId = first.id;
      }
    }

    if (!customerId) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const returnUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return res.json({ url: session.url });
  } catch {
    return res.status(500).json({ error: 'Could not create portal session' });
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

export default router;

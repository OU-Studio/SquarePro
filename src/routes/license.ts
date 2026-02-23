import { LicenseStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma';

const router = Router();

const ALLOWED_STATUSES = new Set<LicenseStatus>([
  LicenseStatus.ACTIVE,
  LicenseStatus.TRIALING,
]);

const normalizeHostname = (hostname: string): string => {
  const raw = hostname.trim().toLowerCase();
  return raw.startsWith('www.') ? raw.slice(4) : raw;
};

router.post('/verify', async (req, res) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const hostnameInput =
      typeof req.body?.hostname === 'string' ? req.body.hostname.trim() : '';

    if (!key || !hostnameInput) {
      return res.json({ active: false, reason: 'INVALID_KEY' as const });
    }

    const license = await prisma.license.findUnique({
      where: { licenseKey: key },
      include: {
        domains: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!license) {
      return res.json({ active: false, reason: 'INVALID_KEY' as const });
    }

    if (!ALLOWED_STATUSES.has(license.status)) {
      return res.json({
        active: false,
        reason: 'INACTIVE_SUBSCRIPTION' as const,
      });
    }

    const normalizedHostname = normalizeHostname(hostnameInput);
    if (!normalizedHostname) {
      return res.json({ active: false, reason: 'INVALID_KEY' as const });
    }

    const existing = license.domains.find((d) => d.hostname === normalizedHostname);

    if (existing) {
      await prisma.licenseDomain.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });

      return res.json({
        active: true,
        boundDomains: license.domains.map((d) => d.hostname),
        maxDomains: license.maxDomains,
      });
    }

    if (license.domains.length >= license.maxDomains) {
      return res.json({ active: false, reason: 'LIMIT_REACHED' as const });
    }

    await prisma.licenseDomain.create({
      data: {
        licenseId: license.id,
        hostname: normalizedHostname,
        lastSeenAt: new Date(),
      },
    });

    const updatedDomains = [
      ...license.domains.map((d) => d.hostname),
      normalizedHostname,
    ];

    return res.json({
      active: true,
      boundDomains: updatedDomains,
      maxDomains: license.maxDomains,
    });
  } catch {
    return res.json({
      active: false,
      reason: 'INACTIVE_SUBSCRIPTION' as const,
    });
  }
});

export { normalizeHostname };
export default router;

# SquarePro Micro-Backend

Minimal backend for Stripe subscription sync + license verification with 2-domain binding.

## Stack

- Node.js 20+
- TypeScript
- Express
- Prisma ORM
- PostgreSQL (Railway)

## Environment

Copy `.env.example` to `.env` and set:

- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL`
- `ADMIN_TOKEN` (optional, required for debug endpoint)
- `PORT` (optional)

## Install

```bash
npm install
```

## Prisma migrations

Create and apply initial migration:

```bash
npx prisma migrate dev --name init
```

Generate client (if needed):

```bash
npx prisma generate
```

For production deploys:

```bash
npx prisma migrate deploy
```

## Run locally

Development:

```bash
npm run dev
```

Build + run:

```bash
npm run build
npm run start
```

## Stripe setup

- Configure webhook endpoint to `POST /stripe/webhook`
- Subscribe events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid` (optional)
  - `invoice.payment_failed` (optional)
- Put signing secret in `STRIPE_WEBHOOK_SECRET`

## Endpoints

### `POST /license/verify`

Input:

```json
{ "key": "SPRO_xxx", "hostname": "www.example.com" }
```

Rules:

- hostnames are normalized to lowercase and `www.` stripped
- active statuses: `ACTIVE`, `TRIALING`
- max 2 domains per license

Success output:

```json
{ "active": true, "boundDomains": ["example.com"], "maxDomains": 2 }
```

Failure output:

```json
{ "active": false, "reason": "INVALID_KEY" }
```

### `POST /stripe/portal-session`

Input (prefer `licenseKey`):

```json
{ "licenseKey": "SPRO_xxx" }
```

or

```json
{ "customerEmail": "owner@example.com" }
```

Output:

```json
{ "url": "https://billing.stripe.com/..." }
```

### `POST /stripe/webhook`

Uses raw request body for signature verification.

### `GET /stripe/license/by-subscription/:subscriptionId` (debug)

Requires header:

```text
x-admin-token: <ADMIN_TOKEN>
```

Returns:

```json
{
  "licenseKey": "SPRO_xxx",
  "status": "ACTIVE",
  "boundDomains": ["example.com", "my-site.squarespace.com"]
}
```

## cURL examples

Verify license:

```bash
curl -X POST http://localhost:3000/license/verify \
  -H "Content-Type: application/json" \
  -d '{"key":"SPRO_xxx","hostname":"www.example.com"}'
```

Create portal session by license key:

```bash
curl -X POST http://localhost:3000/stripe/portal-session \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"SPRO_xxx"}'
```

Create portal session by email:

```bash
curl -X POST http://localhost:3000/stripe/portal-session \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"owner@example.com"}'
```

## Railway deployment notes

- Deploy from repo as a Node service (no Docker required)
- Set env vars listed above in Railway Variables
- Start command:

```bash
npm run start
```

- Build command:

```bash
npm run build
```

- Ensure migrations run before serving traffic (either pre-deploy step or one-off command):

```bash
npx prisma migrate deploy
```

## Pricing Table integration note

Frontend owns checkout via Stripe Pricing Table. Backend receives resulting subscription/customer state through webhook events and keeps license status synced.

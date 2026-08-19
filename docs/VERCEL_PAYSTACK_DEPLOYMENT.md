# Vercel + Paystack deployment guide

## Vercel projects

Create two Vercel projects from this repository.

### Frontend

- Root Directory: `frontend`
- Node.js: `24.x`
- Build Command: `npm run build`
- Output Directory: `dist`
- Production variables:
  - `WORLDNET_API_BASE_URL=https://api.your-domain.example/api`
  - `PUBLIC_APP_URL=https://your-domain.example`
  - `WORLDNET_DEFAULT_DISPLAY_CURRENCY=USD`

### Backend

- Root Directory: `backend`
- Node.js: `24.x`
- Vercel entry point: `api/index.js`
- Routing: `backend/vercel.json`
- Public health endpoint: `/api/health`

The Express app is exported instead of requiring a permanently running listener, and MongoDB connections are cached across warm serverless executions.

## Backend environment variables

Copy `backend/.env.example` into Vercel and replace placeholders. Secrets remain backend-only.

Required platform/runtime configuration:

- `NODE_ENV`
- `MONGODB_URI`
- `JWT_SECRET`
- `FRONTEND_URL`
- `FRONTEND_ORIGINS`
- `BACKEND_URL`
- `WALLET_CURRENCY`
- `USER_PLATFORM_FEE_RATE`
- `BANKING_API_TRANSACTION_FEE_RATE`
- `WITHDRAWAL_ENCRYPTION_KEY`
- `TRANSFER_ENCRYPTION_KEY`
- `CRON_SECRET`
- `DEVELOPER_WEBHOOK_SIGNING_SECRET`
- `DEVELOPER_API_RATE_LIMIT_PER_MINUTE`

Paystack active configuration:

- `PAYSTACK_ENV`
- `PAYSTACK_BASE_URL`
- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_DEFAULT_CURRENCY`
- `PAYSTACK_CHECKOUT_CURRENCIES`
- `PAYSTACK_VIRTUAL_ACCOUNT_CURRENCIES`
- `PAYSTACK_LIVE_ENABLED`
- `PAYSTACK_PLATFORM_APPROVED`

Optional isolated developer environments:

- `PAYSTACK_SANDBOX_BASE_URL`
- `PAYSTACK_SANDBOX_PUBLIC_KEY`
- `PAYSTACK_SANDBOX_SECRET_KEY`
- `PAYSTACK_SANDBOX_WEBHOOK_SECRET`
- `PAYSTACK_SANDBOX_BUSINESS_ID`
- `PAYSTACK_LIVE_BASE_URL`
- `PAYSTACK_LIVE_PUBLIC_KEY`
- `PAYSTACK_LIVE_SECRET_KEY`
- `PAYSTACK_LIVE_WEBHOOK_SECRET`
- `PAYSTACK_LIVE_BUSINESS_ID`

Domain Reseller API variables are preserved exactly as a separate provider integration; see `backend/.env.example`.

## Paystack webhook

Configure the Paystack dashboard webhook to the public HTTPS backend route:

`https://api.your-domain.example/api/payments/paystack/webhook`

Paystack webhook signatures are validated with the server-side `PAYSTACK_SECRET_KEY` using the `x-paystack-signature` header. Never expose the secret key in frontend code. The handler persists event IDs/hashes to prevent duplicate processing.

## Sandbox testing

1. Keep `PAYSTACK_ENV=sandbox` and `PAYSTACK_LIVE_ENABLED=false`.
2. Add sandbox business/API/webhook credentials.
3. Run `npm test` in `backend`.
4. Run `npm run preflight` after setting required local environment variables.
5. Test checkout, virtual-account requests and payouts with Paystack sandbox resources only.
6. Replay a webhook payload in automated tests to confirm duplicate-event protection before production.
7. Do not switch live developer access on until written platform/embedded-finance approval is confirmed; then set `PAYSTACK_PLATFORM_APPROVED=true` and provide live credentials.

## Database migration

Run once against the intended database before enabling the new provider in production:

`npm run migrate`

The migration preserves historical payment records, renames the old wallet customer-code field to a legacy field, and scrubs obsolete reversible developer secret fields without deleting users, wallets, orders, domains or transaction history.

## Manual actions still required

- Add real Paystack sandbox/live credentials in Vercel.
- Confirm Paystack account capabilities and country/currency approval.
- Configure the webhook URL in the Paystack dashboard.
- Set Vercel frontend/backend domains and DNS.
- Run the migration against the production database.
- Keep `PAYSTACK_PLATFORM_APPROVED=false` until written approval covers third-party/platform Banking API use.

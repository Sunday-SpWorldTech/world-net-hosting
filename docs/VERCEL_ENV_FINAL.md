# World Net Hosting — Vercel Environment Setup

## Frontend
Use only these Vite-facing names:
- `VITE_API_BASE_URL`
- `VITE_FRONTEND_URL`
- `VITE_PAYSTACK_PUBLIC_KEY`
- `VITE_DEFAULT_DISPLAY_CURRENCY`

Do not create `WORLDNET_API_BASE_URL` in Vercel.

## Backend
Keep secrets only in Vercel Environment Variables. The backend reads:
- `MONGODB_URI`, `JWT_SECRET`
- `FRONTEND_URL`, `FRONTEND_ORIGINS`, `BACKEND_URL`
- `AZURE_TRANSLATOR_*`
- `DOMAIN_RESELLER_ID`, `DOMAIN_API_KEY`, `DOMAIN_API_MODE`, `DOMAIN_API_BASE_URL`
- `PAYSTACK_ENV`, `PAYSTACK_BASE_URL`, `PAYSTACK_TEST_*`, `PAYSTACK_LIVE_*`
- wallet, reseller-prefix and admin/security variables shown in `.env.sample`

Do not duplicate `PAYSTACK_ENV` or `PAYSTACK_BASE_URL`. Prefer the mode-specific `PAYSTACK_LIVE_*` and `PAYSTACK_TEST_*` variables; the generic `PAYSTACK_PUBLIC_KEY`/`PAYSTACK_SECRET_KEY` aliases are unnecessary.

## Health checks
- `/api/health`
- `/api/connection-check`
- `/api/v1/status`

## Domain provider networking
Domain Name API v2 requires the provider credentials and an allowlisted outbound server IP. Vercel Functions use dynamic egress by default. Use Vercel Static IPs/Secure Compute (as appropriate for the account) and whitelist the resulting outbound IP in Domain Name API before expecting live domain calls to succeed consistently.

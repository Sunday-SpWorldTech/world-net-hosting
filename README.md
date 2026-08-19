# World Net Hosting

Production monorepo containing the static/Vite frontend and Express/MongoDB backend.

Current customer-facing scope:
- Domain services and Domain Reseller API
- Banking, wallets and the World Net Hosting Banking API backed by Paystack
- AI Builder
- User, staff and reseller dashboards

Deployment uses two Vercel projects: `frontend/` and `backend/`. See `docs/VERCEL_PAYSTACK_DEPLOYMENT.md`.

Historical payment-provider records are preserved by the database migration for accounting; no legacy provider runtime integration is active.

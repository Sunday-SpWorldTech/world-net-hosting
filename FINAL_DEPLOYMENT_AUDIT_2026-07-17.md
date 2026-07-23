# World Net Hosting — Final Deployment Audit

Date: 2026-07-17

## Scope reviewed

- Existing roles: `user`, `staff`, `admin`
- Domain search, availability mapping, first-year price and renewal markup separation
- Orders, Paystack initialization, verification and webhook routes
- Wallet deposits, withdrawals, bank transfers, receive accounts and wallet conversion
- GitHub App callback, installation completion, repositories and hosting routes
- Live support chat, attachments, staff/admin replies and translation routes
- Frontend page links, shared scripts and deployment configuration
- Backend and frontend environment samples

## Corrections made

1. Removed real `.env` files from the distributable project. They remain ignored by Git.
2. Replaced unsafe sample secrets with clean placeholders.
3. Added both `.env.sample` and `.env.example` for backend and frontend.
4. Added all required backend settings for MongoDB, JWT, admin PIN, encryption, Paystack, Domain Name API, GitHub App, deployment worker and Azure Translator.
5. Added frontend support for both `WORLDNET_*` and `VITE_*` environment names.
6. Added `render.yaml` for the backend and frontend Render web services.
7. Removed the hard-coded fallback admin PIN. Production now requires `ADMIN_LOGIN_PIN`.
8. Production now requires a separate `ENV_ENCRYPTION_KEY` instead of silently reusing the JWT secret.
9. Fixed hosting dashboard metric rendering so missing optional elements cannot cause `Cannot set properties of null` errors.
10. Added a complete static-site build that copies every HTML page, asset and image instead of producing an incomplete Vite build.
11. Updated the frontend server to serve the built site when `dist` exists and inject the API URL, Paystack public key and default currency at runtime.
12. Refactored backend startup so the Express app can be smoke-tested without connecting to MongoDB.
13. Added `/api/health`, `/api/github/status` and API 404 smoke tests.
14. Corrected the backend startup log name to World Net Hosting.

## Audit results

- Backend JavaScript syntax: PASS
- Frontend JavaScript syntax: PASS
- Backend route smoke test: PASS
- GitHub callback status route: PASS
- Unknown API route returns 404: PASS
- Frontend complete static build: PASS
- Local HTML links/assets: PASS (38 pages, 0 broken local references)
- Shared `env.js` included on all pages: PASS
- Shared `app.js` included on all pages: PASS
- Backend production dependency audit: 0 vulnerabilities
- Frontend dependency audit: 0 vulnerabilities
- Sample-secret scan: PASS (placeholders only)
- `.env` Git ignore check: PASS

## Important live-service requirements

Code-level readiness does not activate external provider features. Before live use:

- Paystack Transfers must be enabled for the business.
- Paystack Dedicated Virtual Accounts must be enabled for the business.
- The Paystack webhook must point to `/api/payments/paystack/webhook`.
- The Domain Name API account must have a valid live reseller balance and credentials.
- The GitHub App callback must point to `/api/github/callback`.
- The GitHub webhook must point to `/api/github/webhook`.
- The deployment worker must be independently deployed and configured before customer code can actually build and run.
- Azure Translator credentials are required for multilingual page/chat translation.

No live payment, bank transfer, domain registration or GitHub provider request was executed during this offline audit. Those operations require the owner's live credentials and enabled provider account features.

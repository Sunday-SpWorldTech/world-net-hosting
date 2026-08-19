# World Net Hosting Final ENV/API Update

Updated 2026-08-18.

- Frontend build variable: `VITE_API_BASE_URL=https://world-net-hosting-backend.vercel.app/api`
- Frontend Paystack variable is wired through `VITE_PAYSTACK_PUBLIC_KEY`.
- Backend CORS accepts `https://world-net-hosting-frontend.vercel.app`.
- Domain Name API production base was migrated away from the retired `/api/v1` base to `https://api.domainresellerapi.com`.
- Domain availability now uses the current v2-style `api/domain/check` request with HTTP Basic authentication from `DOMAIN_RESELLER_ID` + `DOMAIN_API_KEY`.
- Vercel catch-all API entry remains enabled for `/api/*` routes.
- `.env` files contain the supplied deployment values for local verification but remain excluded by `.gitignore`; Vercel production secrets must remain configured in Vercel Environment Variables.
- After any Vercel Environment Variable change, redeploy the backend and then the frontend.

Validation completed:
- Backend preflight: passed.
- Backend JavaScript syntax: passed.
- Frontend production build: passed.
- Local `/api/health`: HTTP 200.
- Local CORS test: frontend origin accepted.
- Local `/api/connection-check`: domain API, Paystack live and CORS configuration reported configured.

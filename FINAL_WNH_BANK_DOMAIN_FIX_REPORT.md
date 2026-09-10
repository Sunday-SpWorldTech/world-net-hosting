# World Net Hosting Final Banking + Domain API Update

- Preserved backend/.env, frontend/.env, backend/.env.sample and frontend/.env.sample without modification.
- Kept Vercel Express rewrite routing to backend/api/index.js.
- Domain search accepts both ?name= and ?domain=.
- Domain search no longer fails just because MongoDB audit logging is temporarily unavailable.
- Domain provider integration first uses the Basic-auth /api/domain/check flow and falls back to the documented /v1/domain/check JSON credential flow when the gateway rejects/not-founds the first format.
- User receiving bank account details are loaded from /api/wallet/banking/summary and displayed across authenticated user dashboard pages with copy actions.
- Reseller dashboard menu now starts with WNH Bank, followed by Register Domain. API key pages remain at the bottom.
- Dashboard hero now prioritizes WNH Bank and domain management instead of developer APIs.

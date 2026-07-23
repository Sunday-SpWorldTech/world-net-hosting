# Batch 100 and Projects & Hosting Re-audit

## Domain search
- `DOMAIN_SEARCH_BATCH_SIZE=100` in `backend/.env` and `backend/.env.sample`.
- Backend maximum and default batch size are both 100.
- A 200-TLD search is sent as two requests of 100.
- No Render dedicated-IP creation/list endpoint or helper script exists in this project.
- Provider errors are preserved instead of being automatically rewritten as an IP-whitelist error.

## Roles
- No role definitions, role middleware, wallet permissions, staff/admin routes, or reseller permissions were modified.
- Hosting pricing continues to use the authenticated role: admin receives wholesale pricing; non-admin roles receive the configured markup.

## Projects & Hosting verification
- JavaScript syntax validation passed for frontend, backend, GitHub App service, hosting routes, and deployment worker.
- Frontend production static build passed.
- Backend route smoke test passed.
- GitHub App repository listing, installation completion, project subscriptions, and direct Render deployment routes remain present.
- Render workspace `ownerId` is still required for creating normal Render services. This is unrelated to dedicated IPs and must remain for Projects & Hosting deployment.

## Production credentials
The preflight correctly reports placeholder or incomplete credentials in the uploaded environment file. Real credentials must be configured in the new Render service environment for GitHub, Paystack, Domain API, encryption, and admin PIN features to operate live.

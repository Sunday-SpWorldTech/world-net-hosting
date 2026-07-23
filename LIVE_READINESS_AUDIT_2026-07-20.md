# World Net Hosting Live-Readiness Audit

Date: 2026-07-20

## Result

The updated source, production URLs, route protections, 200-extension domain search, frontend build, and Render integration are ready to deploy. Real payment launch remains intentionally blocked until matching Paystack `pk_live_` and `sk_live_` keys are configured on Render. The supplied Paystack credentials authenticate in test mode only.

## External service audit

| Service | Audit result | Launch state |
| --- | --- | --- |
| MongoDB | The currently deployed backend health response reports a connected database. | Connected |
| Domain Name API | Live account access is configured. A direct 200-domain bulk call from the audit environment was denied by the provider's authorized-IP control, so the final bulk call must be checked from the newly deployed Render backend. | Conditional on Render outbound-IP authorization |
| Paystack | The supplied public and secret keys are a matching test pair and authenticate successfully. Production now enforces a matching live pair when `PAYSTACK_REQUIRE_LIVE=true`. | Live keys required |
| Azure Translator | Credential and one live translation request returned successfully. | Ready |
| GitHub OAuth | Live authorization start redirects to GitHub successfully. | Ready |
| GitHub App | App credentials and RSA private key validate; the configured app slug matches. | Ready |
| Render API | API key and workspace access validate. Current backend and frontend service IDs were resolved and the stale backend ID was replaced. | Ready |

## Completed launch hardening

- Domain search uses exactly 200 unique current ASCII TLDs and sends one bulk provider request.
- Missing provider entries are represented safely so the UI always receives all 200 searched extensions without inventing availability or pricing.
- Domain results initially show 12 entries, then support Show More and Show Less until all 200 are visible.
- Real Render custom-domain create, sync, verify, delete, DNS, and TLS-status flows replace the former placeholder edge IP.
- Render's root-domain A record (`216.24.57.1`), service CNAME target, and AAAA removal instruction are returned to the dashboard.
- Free-plan activation no longer redirects to an undefined payment URL; the one-project and monthly-deployment limits are enforced.
- Custom domains require an eligible active hosting plan.
- Project deletion also removes its Render service and subscriptions, avoiding orphan infrastructure.
- Provider account status is admin-only.
- Support chats use an unguessable access token; chat state and attachments are no longer public by MongoDB ID alone.
- Public write, authentication, search, translation, currency, and payment-verification APIs have rate limits.
- Payment verification returns only the fields needed by the confirmation page.
- External API requests use bounded timeouts.
- Production preflight checks credentials, HTTPS URLs, service IDs, the 200-TLD catalog, and matching Paystack mode.
- The production blueprint refuses to start with Paystack test keys.
- Test Paystack keys were removed from all browser assets and production build output.
- No active frontend, backend-public, Render, or backend production URL points to localhost, `127.0.0.1`, or `0.0.0.0`.

## Verification completed

- JavaScript syntax checks: passed.
- Backend route smoke checks: passed.
- Production environment preflight: passed, with the expected Paystack test-mode warning.
- Frontend production build: passed.
- Frontend HTTP asset smoke test: passed.
- 200 unique TLD assertion: passed.
- Single bulk-search assertion: passed.
- Show More and Show Less assertion: passed.
- Frontend/dist/backend-public mirror checks: passed.
- Root, frontend, backend, and deployment-worker dependency audits: zero known vulnerabilities.

## Required before public launch

1. Add matching Paystack live keys to the Render backend and set the same live public key as `WORLDNET_PAYSTACK_PUBLIC_KEY` on the frontend.
2. Deploy this updated package to the current Render services.
3. Confirm the domain provider's authorized-IP list permits the deployed backend's outbound traffic.
4. Confirm `/api/health` reports `productionReady: true` and no readiness issues.
5. Run one domain search on the deployed site and confirm `totalExtensions: 200` with 200 result rows.

Do not upload `.env` files or private keys to source control. Configure secrets only in Render's environment settings.

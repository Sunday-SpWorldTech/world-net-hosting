# World Net Hosting Update — 2026-08-15

## Backend / Vercel
- Removed the catch-all Vercel rewrite that collapsed every backend route into `/api`.
- Kept Express as the Vercel framework and the exported Express app entrypoint.
- `/api/health` and `/api/connection-check` no longer require MongoDB to be connected before responding.
- Existing authenticated API routes still require the database.

## Banking
- Added `Create Bank Account` to the Banking services grid.
- Reused the existing Paystack dedicated receiving-account API route.
- Renamed the receive-account page UI to `Create Bank Account` while retaining the same route for compatibility.
- Added simultaneous Paystack test/live credential support:
  - `PAYSTACK_TEST_PUBLIC_KEY`
  - `PAYSTACK_TEST_SECRET_KEY`
  - `PAYSTACK_LIVE_PUBLIC_KEY`
  - `PAYSTACK_LIVE_SECRET_KEY`
- Existing `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` remain supported for backward compatibility.
- Developer Banking API payouts now use the environment associated with the API key, preventing test credentials from falling through to the active/live payout environment.

## Dashboard navigation
Account dashboard order is now:
1. Banking
2. Register Domain
3. DNS Manager
4. Business Email
5. Transfer Domain
6. Receive Domain
7. Overview
8. AI Builder
9. Support
10. Banking API KEY's
11. Domain Reseller API KEY's

Admin/staff navigation was also reordered to make banking and domain operations more prominent.

## Validation
- Backend automated tests: PASS (3/3)
- Frontend production build: PASS
- Local `/api/health`: HTTP 200 without requiring MongoDB readiness
- Local `/api/connection-check`: HTTP 200

## Deployment note
Configure the Vercel backend project with Root Directory `backend` and the frontend project with Root Directory `frontend`.

# World Net Hosting — Final Production Update

## Critical fix
The supplied project contained unresolved Git merge-conflict markers in production JavaScript files. These markers caused Node.js syntax failure and can directly produce Vercel `FUNCTION_INVOCATION_FAILED` / HTTP 500 errors when the backend function is loaded.

Resolved files:
- `backend/src/server.js`
- `backend/src/models/ResellerApiPayment.js`
- `frontend/assets/js/reseller.js`

The final source contains no Git conflict markers.

## Domain purchase flow
- First-year domain pricing uses the live provider price with 0 WNH first-year markup.
- Renewal pricing uses provider renewal price plus `DOMAIN_RENEWAL_MARKUP_RATE` (defaulting to the configured user platform rate, currently 4% unless overridden).
- Checkout pricing is recalculated server-side from live provider data before order creation.
- Paystack payment verification checks the received amount against the order before fulfillment.
- Verified paid domain orders are automatically provisioned through the Domain Reseller API.
- The domain is rechecked for availability immediately before registration.
- Registration is recorded in `ManagedDomain` with provider reference and response.
- Provisioning failures are recorded on the order for retry/recovery instead of being silently marked complete.

## Reseller APIs
The project retains the reseller domain and banking API routes and the domain API endpoints for search, registration, lookup and renewal.

## Vercel deployment
Deploy the backend as a Vercel project with **Root Directory = `backend`**. Deploy the frontend separately with **Root Directory = `frontend`**.

Do not upload `.env` files. Configure production secrets in Vercel Environment Variables.

## Verification performed
- No unresolved merge-conflict markers remain.
- JavaScript syntax check passed for backend and frontend JavaScript source files.
- Frontend static build completed successfully.
- Backend Paystack test suite passed: 3/3 tests.

A full live domain registration was not performed because that would create a real registrar transaction. Live API credentials must be configured in Vercel before production provisioning can be exercised.

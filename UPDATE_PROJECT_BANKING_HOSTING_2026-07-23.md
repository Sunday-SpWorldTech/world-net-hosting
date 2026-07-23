# Banking, Projects & Hosting Production Repair

- Removed credentialed cross-origin browser fetches from Banking pages so Bearer-token requests are not blocked by cookie/CORS policy.
- Replaced the generic reconnecting message with a backend reachability message.
- Added authenticated `/api/wallet/health` diagnostics.
- Removed the one-free-project subscription restriction. Each owned project may use the free plan, subject to the configured monthly deployment allowance.
- Increased the default free monthly deployment allowance to 100 while keeping `HOSTING_FREE_MONTHLY_DEPLOYS` configurable.
- Hosting plans and subscriptions now display and store customer pricing in USD.
- Paystack settlement remains NGN and the backend converts the USD charge using `FALLBACK_USD_NGN_RATE` before initialization.
- Added language and currency controls to all Projects & Hosting dashboard pages through the existing global selector.
- Payment checkout now remembers the originating dashboard or project and returns there after verification.
- Rebuilt `frontend/dist` and synchronized `backend/public`.

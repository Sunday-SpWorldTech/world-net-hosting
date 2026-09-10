# World Net Hosting — Domain, Paystack & Reseller API Update

## What was inspected before the update

The project was reviewed across the backend Express/Vercel entrypoints, Paystack service, payment models, domain models, reseller API authentication, reseller dashboard/frontend, domain search/cart flow, deployment configuration, and the existing implementation reports.

The existing architecture already had:
- Paystack server-side checkout initialization and verification.
- A Paystack webhook route.
- Domain Name API live search and registration provisioning logic.
- Reseller API credentials for Domain and Banking products.
- A Banking API payment flow.
- A reseller wallet and domain wallet-purchase flow.

## Changes made

### 1. First-year domain pricing
- Customer first-year domain registration now uses the live provider price with **0 USD WNH domain markup**.
- Checkout no longer trusts the frontend's domain price.
- The backend re-checks the domain and retrieves the current provider price before creating the Paystack order.
- A stale/tampered frontend price therefore cannot reduce the amount charged.

### 2. Renewal pricing
- Renewal pricing is now based on the provider's renewal price plus a configurable percentage.
- `DOMAIN_RENEWAL_MARKUP_RATE` is configurable in the backend environment.
- It defaults to the existing `USER_PLATFORM_FEE_RATE` when not explicitly set.
- The current sample environment therefore uses the existing 4% rate, while allowing the owner to change it later without changing source code.

### 3. Paystack payment protection
- Paystack order fulfillment now checks the verified provider amount against the amount stored for the order.
- An amount mismatch prevents the order from being marked paid and prevents domain provisioning.
- Existing duplicate-settlement protection remains in place.
- Successful verified orders still trigger domain provisioning automatically.

### 4. Domain provisioning
- After verified payment, the backend re-checks live domain availability immediately before registration.
- The provider registration call remains server-side.
- Successful registrations are stored in `ManagedDomain` with provider reference, provider response, nameservers and expiry data where returned.
- Failed provisioning remains recorded on the order so it can be retried/recovered rather than silently disappearing.

### 5. Domain Reseller API
Added API capabilities for reseller platforms:
- `GET /api/v1/domains/search`
- `POST /api/v1/domains/register`
- `GET /api/v1/domains/:domain`
- `POST /api/v1/domains/renew`

Domain registration/renewal API operations use idempotency keys and the reseller's WNH wallet. The API re-checks live provider pricing and availability before charging/registering.

Domain API scopes now include:
- `domains:read`
- `domains:write`
- `domains:renew`

### 6. Banking / Paystack Reseller API
The existing Banking API flow remains server-side and Paystack-backed, with the reseller-facing API continuing to support payment initialization, verification/status lookup, wallet balance, customers, virtual accounts, payouts and developer webhooks.

The reseller API continues to use WNH-issued public/secret API credentials; Paystack secret credentials are not exposed to reseller applications.

### 7. Security cleanup
- The generated environment sample was sanitized so database credentials and JWT secrets are not included as working secrets.
- The real deployment credentials should remain in Vercel/server environment variables, not source control.

## Validation

- Backend JavaScript syntax: passed.
- Frontend JavaScript syntax: passed.
- Existing backend Paystack tests: **3/3 passed**.
- Frontend static build: passed.

## Important deployment setting

Set the desired renewal percentage in the backend environment:

`DOMAIN_RENEWAL_MARKUP_RATE=0.04`

For a different percentage, change the value without changing the application code.

Do not place Paystack secret keys or Domain Name API secrets in the frontend.

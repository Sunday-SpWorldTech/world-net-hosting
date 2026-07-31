# World Net Hosting live API environment setup

The project is configured to use these real provider endpoints:

- Domain provider: Domain Name API
- Domain live gateway: `https://api.domainresellerapi.com/api/v1`
- Banking and payment provider: Paystack
- Paystack gateway: `https://api.paystack.co`

Only the private credentials below must be replaced with credentials issued to the World Net Hosting business:

- `DOMAIN_RESELLER_ID`
- `DOMAIN_API_KEY`
- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `VITE_PAYSTACK_PUBLIC_KEY` (same public key as `PAYSTACK_PUBLIC_KEY`)

Never place `PAYSTACK_SECRET_KEY` or `DOMAIN_API_KEY` in the frontend. After matching Paystack live keys (`pk_live_` and `sk_live_`) are configured and the backend restarts, live reseller Banking API readiness and automatic approval are enabled by the backend.


## Separate reseller API credentials

Domain and Banking API credentials are generated independently. Domain keys use `DOMAIN_RESELLER_*_PREFIX` variables and can access only `/api/v1/domains/*`. Banking keys use `BANK_RESELLER_*_PREFIX` variables and can access only `/api/v1/banking/*`. Provider secret keys remain private in the backend.

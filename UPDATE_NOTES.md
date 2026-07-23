# World Net Hosting update

This build connects domain operations through the backend only and never exposes reseller or Paystack secret keys in the browser.

## Required Render variables

Set `DOMAIN_API_MODE=live`, `DOMAIN_RESELLER_ID`, `DOMAIN_API_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_SECRET_KEY`, `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL`, and `PAYSTACK_CALLBACK_URL`.

Set the Paystack webhook URL to:

`https://YOUR-BACKEND.onrender.com/api/payments/paystack/webhook`

The wallet is credited only after a signed Paystack webhook or successful server-side verification. Duplicate references are ignored.

## DomainNameAPI endpoint compatibility

The provider publishes its current production operations in the Swagger page. Default endpoint paths are included. If the exact path in your reseller account differs, set the corresponding `DOMAIN_ENDPOINT_*` variable without changing source code.

DNS zone records are not falsely simulated. Registrar nameserver management is connected. A/AAAA/CNAME/MX/TXT record editing requires an authoritative DNS-hosting API; configure that provider before enabling zone-record buttons.

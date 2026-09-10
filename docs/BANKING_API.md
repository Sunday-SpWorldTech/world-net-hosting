# World Net Hosting Banking API

## Security model

World Net Hosting is the API boundary. Developer applications never receive Paystack credentials.

- Sandbox and live developer keys are separate.
- Public keys identify a project; secret keys are shown once and stored only as bcrypt hashes.
- Live Banking API access requires both Paystack live credentials and `PAYSTACK_PLATFORM_APPROVED=true`.
- Every key has scopes and optional IP restrictions.
- Financial create operations require `Idempotency-Key` where documented.
- Rate limits are enforced through a shared MongoDB counter, not process memory.
- Audit records are tenant/project scoped.

## API authentication

Send:

- `X-API-Key: <project public key>`
- `X-API-Secret: <project secret>`

Base path: `/api/v1`.

## Banking endpoints

- `GET /api/v1/banking/balance`
- `POST /api/v1/banking/customers`
- `GET /api/v1/banking/customers/:reference`
- `POST /api/v1/banking/customers/:reference/accounts`
- `GET /api/v1/banking/customers/:reference/accounts/:currency`
- `POST /api/v1/banking/payments/initialize`
- `GET /api/v1/banking/payments/:reference`
- `GET /api/v1/banking/transactions`
- `GET /api/v1/banking/capabilities`
- `GET /api/v1/banking/rates`
- `POST /api/v1/banking/payouts`
- `POST /api/v1/banking/webhook`
- `GET /api/v1/openapi.json`

## Scopes

Default Banking API project scopes:

- `banking:read`
- `payments:create`
- `accounts:create`
- `payouts:create`
- `webhooks:write`

## Outbound webhook verification

World Net Hosting sends:

- `x-wnh-event-id`
- `x-wnh-timestamp`
- `x-wnh-signature`

The signature is an HMAC-SHA256 hex digest over:

`eventId + "." + timestamp + "." + rawJsonBody`

Use the webhook verification secret shown when the webhook is registered. Reject old timestamps and duplicate event IDs. Delivery records are persisted and retried by the scheduled retry endpoint.

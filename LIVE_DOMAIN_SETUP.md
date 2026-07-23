# Live Domain Name API setup

Use the provider **Live Environment API Key**. The Test Environment key intentionally returns sandbox/mock data and cannot register real domains.

Render environment variables:

```env
DOMAIN_RESELLER_ID=your-reseller-uuid
DOMAIN_API_KEY=your-live-environment-api-key
DOMAIN_API_MODE=live
DOMAIN_API_ALLOW_CUSTOM_BASE=false
DOMAIN_API_BASE_URL=https://api.domainresellerapi.com/api/v1
```

After deployment, test:

- `/api/health` — must show `domainApiMode: live`
- `/api/domains/provider-status` — must return `ok: true` and your reseller account
- `/api/domains/search?name=example.com` — returns the exact searched domain only

If provider-status returns 401, the key is not the live key or the ID/key pair does not match. If it returns 403, authorize the server IP in the reseller panel.

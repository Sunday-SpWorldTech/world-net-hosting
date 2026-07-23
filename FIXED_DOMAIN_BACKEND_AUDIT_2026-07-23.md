# World Net Hosting forensic repair

## Confirmed root cause

The current backend hardcoded `DOMAIN_SEARCH_TLD_LIMIT=200` and ignored the configured `DOMAIN_SEARCH_TLDS` environment value. Every search transformed the requested name into 200 domains and sent them to the reseller in batches of 12. That created up to 17 external provider calls for one browser search, with a 60-second timeout per provider call and delays between batches.

On a free Render instance this can keep requests open for a long time, increase memory/socket usage, trigger provider throttling, and make unrelated frontend pages report generic backend connection messages. The repository does not contain code that requires a Render outbound IP for domain search. The HTTP 403 handler mentions permissions, request limits, extensions, and credentials; it does not prove an IP restriction.

## Repairs applied

- The 200-TLD catalogue remains available.
- The exact requested domain is queried first.
- Only 12 results are requested by default: the exact domain plus controlled suggestions.
- The result limit is configurable with `DOMAIN_SEARCH_RESULT_LIMIT` and capped at 50.
- Provider calls remain batched and never query all 200 during one normal page load.
- `DOMAIN_SEARCH_TLDS` is now respected, normalized, deduplicated, and validated.
- Authorization and malformed-request failures stop further batches immediately.
- Cache keys include the result limit.
- API responses now report catalogue size, returned result count, failed batches, and whether more extensions exist.
- The broken `backend/src/preflight.js` script was repaired by defining the missing `clean()` helper.

## Recommended Render variables

```env
DOMAIN_SEARCH_RESULT_LIMIT=12
DOMAIN_SEARCH_BATCH_SIZE=12
DOMAIN_SEARCH_BATCH_DELAY_MS=150
DOMAIN_SEARCH_CACHE_MS=120000
```

Keep the existing 200-entry catalogue. Do not add `RENDER_OUTBOUND_IP`, `HOSTING_EDGE_IP`, or another artificial IP requirement.

## Verification completed

- `node --check backend/src/server.js` passed.
- `node --check backend/src/preflight.js` passed.
- Backend started successfully and listened on port 10000.
- Preflight now executes correctly and reports only actual placeholder/missing environment configuration.

Live reseller, Paystack, MongoDB, GitHub, and Render API transactions could not be completed inside the offline audit container. They must be tested after setting the real secrets on Render.

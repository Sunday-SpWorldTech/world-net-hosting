# Rehost without a dedicated Render IP

The domain search no longer depends on a Render dedicated IP. The backend sends the 200 TLD checks in small batches and keeps successful results when an individual batch fails.

## Required Render settings

Keep the existing backend environment variables. Do not add a dedicated-IP variable. Render API variables remain required only for the Projects & Hosting deployment feature.

## Domain search controls

- `DOMAIN_SEARCH_BATCH_SIZE=100`
- `DOMAIN_SEARCH_BATCH_DELAY_MS=200`

The backend now preserves the domain provider's actual 403 response instead of automatically reporting every 403 as an IP allowlist failure.

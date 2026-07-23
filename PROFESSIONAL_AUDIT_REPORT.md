# World Net Hosting Professional Audit

## Implemented
- Searchable language and currency controls with typing, Enter selection, Escape close, persisted choices and automatic country/currency suggestion.
- Live domain search customer pricing uses a configurable fixed USD markup (`DOMAIN_CUSTOMER_MARKUP_USD=8.69`) while preserving wholesale price separately.
- Separate user wallets and system/admin wallet with idempotent Paystack webhook crediting.
- Admin maintenance mode API and dashboard controls.
- Staff role, permissions field, support conversation list, replies and status updates.
- Admin user role/status APIs for promoting users to staff and controlling access.
- Dashboard/static routing verified; all local dashboard links resolve to existing pages.
- Safe `.env.sample` placeholders; real `.env` remains excluded by `.gitignore`.

## Verified
- JavaScript syntax checks pass for backend, frontend and deployment worker.
- Dashboard HTML link audit reports zero missing local links.
- Frontend files are synchronized into backend/public for single-service fallback hosting.

## External limitations
- Real Paystack charges require valid enabled merchant keys and supported account currency.
- Real domain registration/DNS/renewal requires valid Domain Name API credentials, provider endpoint compatibility and sufficient reseller balance.
- GitHub App requires a real PEM private key, not a SHA-256 fingerprint.
- Full live external transactions were not executed to avoid charging accounts or registering domains during local audit.

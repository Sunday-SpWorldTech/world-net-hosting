# World Net Hosting Final Paystack + Dashboard Audit

## Provider migration
- Removed active legacy payment-provider references from source, frontend, backend environment templates, tests, package metadata, and documentation.
- Replaced payment initialization/verification, bank listing/account resolution, transfers, dedicated receiving accounts, reseller banking API provider labels, and webhook handling with Paystack.
- Paystack secrets stay backend-only. Frontend environment contains only API base URL and display currency.
- Paystack webhook verification uses `x-paystack-signature` and HMAC-SHA512 with the Paystack secret key.
- Existing generic transaction, wallet, order, provider-reference, and audit fields remain so historical application records are not deleted.

## Dashboard parity
The original user/reseller dashboard remains unchanged as the visual reference.

### Admin
- Added `frontend/admin.html` as a complete admin dashboard entry while retaining `admin-dashboard.html` for backward compatibility.
- Uses the same `style.css`, `dashboard.css`, `dashboard-fix.css`, app shell, sidebar, topbar, hero system, colors, typography, responsive menu and locale slot as the account dashboard.
- Preserves admin-only Users, Orders, Wallets, Banking Transfers, Domain Activity and Support controls.
- Restores common account pages: Register Domain, DNS Manager, Business Email, Transfer Domain, Receive Domain, Banking and AI Builder.
- Admin session token can be used by shared account pages, while backend role checks still govern privileged operations.

### Staff
- Keeps staff signup/sign-in, PIN flow, approval requirement and support/case-management tools.
- Uses the same account dashboard shell/design system.
- Preserves User Support and Conversations.
- Restores common account pages: Register Domain, DNS Manager, Business Email, Transfer Domain, Receive Domain, Banking, AI Builder and Support.
- Dashboard menu generation now recognizes staff separately instead of incorrectly rebuilding the staff menu as a reseller menu.

## Verification
- No legacy payment-provider references remain outside Git metadata/node_modules.
- Backend and frontend JavaScript syntax checks pass.
- Backend provider tests: 3 passed, 0 failed.
- Frontend static production build completes successfully.

# World Net Hosting — Complete Update Audit

Date: 2026-07-16

## Role integrity
- Preserved the existing `user`, `staff`, and `admin` roles.
- Preserved `staffPermissions` and existing MongoDB role records.
- Authentication now reloads the current database role on every protected request, so a stale JWT cannot retain an old role.
- Inactive accounts are blocked from protected APIs.
- User, staff, and admin route guards remain separate.
- Existing staff accounts with no granular permissions retain legacy support access; configured permissions are enforced when present.

## Admin access
- Replaced admin email/password UI with PIN-only login.
- PIN is checked on the backend using `ADMIN_LOGIN_PIN`.
- Default requested PIN is `12121991`; production should set it in Render.
- The login authenticates the existing active admin account and does not create or change roles.
- Added failed-attempt counting and a 15-minute lockout after repeated failures.

## 4% user service fee
- Added `USER_PLATFORM_FEE_RATE=0.04`.
- User wallet deposits: Paystack charge = entered deposit + 4%; wallet credit = entered deposit only.
- User domain/cart purchases: subtotal + 4% platform fee is converted to NGN and sent to Paystack.
- User hosting subscriptions: base plan + 4% platform fee is sent to Paystack.
- Admin system-wallet deposits are excluded from the 4% platform fee and use only the real Paystack/API charge applied by the provider.
- Fee, base amount, charged amount, and rate are stored in payment metadata/order data for auditing.

## Domain pricing
- First-year registration continues to display and charge the live provider registration price.
- Renewal price remains separate: live provider renewal price plus configured renewal markup.
- Premium domains are not automatically given the fixed renewal markup.
- USD remains the base commercial price; Paystack checkout converts the final payable amount to NGN on the backend.

## GitHub and hosting
- Added the missing `/api/github/callback` route before the API 404 handler.
- GitHub installation callbacks now redirect to `dashboard-hosting.html` with installation details.
- The authenticated hosting dashboard completes the installation and loads authorized repositories.
- Frontend/static, backend/web service, and worker project types remain separate.
- Environment values remain AES-256-GCM encrypted before database storage.
- Hosting plans use subscription checkout rather than the normal domain cart.
- Deployment still correctly requires an active hosting subscription, GitHub connection, and configured external deployment worker.

## Dashboard UI
- Reduced dashboard hero, heading, card, and statistic sizes.
- Added responsive card grids and overflow protection for email and wallet values.
- Kept the sidebar fixed with independent scrolling.
- Added Wallet & Deposit and Transactions navigation entries to customer dashboard pages.
- Added a visible explanation of the 4% user deposit service fee.
- Reduced hosting dialogs and forms for smaller screens.

## Language and currency
- Existing searchable language/currency controls remain in place.
- Currency configuration now exposes the platform fee rate/percentage.
- Existing no-refresh selection and saved preferences were preserved.

## Verification completed
- `node --check backend/src/server.js` — passed.
- `node --check backend/src/routes/hostingRoutes.js` — passed.
- `node --check frontend/assets/js/app.js` — passed.
- `node --check frontend/assets/js/hosting-dashboard.js` — passed.
- Root `npm run check` — passed.
- Backend production dependency audit — 0 vulnerabilities.
- Frontend dependency audit — 0 vulnerabilities.
- Internal HTML-link audit — 0 missing local HTML targets.
- Route assertions confirmed admin PIN, GitHub callback, role preservation, active-account checks, 4% fees, admin exclusion, first-year pricing, and renewal markup separation.

## Render environment required
Set these values on the backend Render service:

```env
ADMIN_LOGIN_PIN=12121991
USER_PLATFORM_FEE_RATE=0.04
FRONTEND_URL=https://world-net-hosting-frontend.onrender.com
GITHUB_CALLBACK_URL=https://world-net-hosting-backend.onrender.com/api/github/callback
PAYSTACK_CALLBACK_URL=https://world-net-hosting-frontend.onrender.com/payment-success.html
```

Keep all existing MongoDB, Paystack, Domain Name API, GitHub App, encryption, and deployment-worker secrets unchanged.

## Live-service limitation
Static and code-level audits passed. A real end-to-end domain purchase, Paystack charge, GitHub installation, and customer-code deployment cannot be completed from an offline build environment. Those final live checks depend on the valid secrets and services configured in Render, GitHub, Paystack, Domain Name API, MongoDB, and the deployment worker.

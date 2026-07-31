# Google Deceptive Pages Repair

Updated only the reported sign-in and AI Builder presentation/security flow plus the shared dashboard menu flow used by Banking pages.

## Updated
- `frontend/signin.html`: transparent account-purpose wording, no sensitive-data request claims, noindex/noarchive, unchanged login form IDs/routes.
- `frontend/ai-builder.html`: clearly public information first; authentication happens only after Create Website is selected; no password, PIN, payment, bank-account, or identity-document request on this page.
- `frontend/dashboard-wallet.html`: moved an orphaned style block back inside the HTML document.
- Rebuilt `frontend/dist`.

## Preserved
- All `.env` and `.env.sample` files byte-for-byte.
- Login, password, PIN, JWT, database, wallet, Paystack, domain API, role permissions, and existing users.
- Existing filenames and routes.
- Google verification file.

## Validation
- `npm run check`: passed.
- `npm --prefix frontend run build`: passed.
- JavaScript syntax checks: passed.
- Git conflict markers: none.

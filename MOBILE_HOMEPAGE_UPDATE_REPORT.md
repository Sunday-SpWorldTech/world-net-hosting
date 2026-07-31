# World Net Hosting Mobile and Homepage Update

## Completed
- Changed only the visible public homepage header brand text from **World Net Hosting** to **WNH**.
- Added a public **Reseller API** navigation button and reseller section.
- Added a public AI Builder information section; protected generation actions route through sign-in.
- Replaced the public banking preview with protected NGN/USD balance states, wallet actions, and transaction-history empty state.
- Added ten useful homepage service cards covering domains, transfer, DNS, nameservers, business email, wallet, reseller services, AI Builder, account security, and support.
- Added a professional off-canvas mobile dashboard menu layer with backdrop, close behavior, scrollable navigation, sticky mobile top bar, responsive locale controls, cards, forms, tables, wallet panels, and service frames.
- Kept Project & Hosting removed and did not reintroduce any deployment flow.

## Files changed
- `frontend/index.html`
- `frontend/assets/css/style.css`
- `frontend/assets/css/dashboard.css`
- Generated static copies under `frontend/dist/`

## Validation
- `npm run check` — passed.
- `npm --prefix frontend run build` — passed.

## Important external checks
- Browser Safe Browsing reputation, live SSL certificate validity, DNS, mixed-content requests, and production security headers require testing against the deployed production URL. They cannot be conclusively verified from the local source archive alone.
- Existing backend authentication, wallet, Paystack, role, database, and reseller API logic were preserved.

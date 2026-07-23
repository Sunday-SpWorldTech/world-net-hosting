# World Net Hosting Mobile and Joinfree Update Audit

## Requested changes completed
- Changed public navigation label `Users/Access` to `Joinfree`.
- Reduced language and currency control sizes without changing currency conversion, persistence, translation, or role logic.
- Prevented embedded dashboard service pages from injecting duplicate live-chat widgets.
- Preserved one shared top-level chat widget across supported dashboard pages.
- Kept standalone Banking transaction pages free from live chat, preserving the previous transaction-page rule.
- Added a professional mobile dashboard drawer with Menu button, backdrop, close-on-navigation, Escape close, and desktop reset.
- Improved public mobile navigation, responsive cards, hero sizing, forms, dashboard top bar, locale controls, and Banking layouts.
- Rebuilt `frontend/dist` and synchronized `backend/public`.

## Validation
- Frontend static build: passed.
- JavaScript syntax checks: passed.
- Backend environment preflight: passed with expected warnings for blank `DEPLOYMENT_WORKER_URL` and `HOSTING_EDGE_IP`.
- Backend route smoke test: passed.
- Old `Users/Access` / `User/Access` labels in generated HTML: zero.
- Static duplicate support widgets in HTML: zero.
- All frontend pages contain a mobile viewport declaration.
- Active production localhost URLs: zero.

## Preserved behavior
- User, staff, and admin roles were not changed.
- Currency conversion and selected-currency persistence were not changed.
- Language translation and selected-language persistence were not changed.
- Banking fees, payment rules, domain rules, API endpoints, GitHub/Render integration, and existing visual identity were not changed.

# PIN Fetch and Public Controls Fix Report

## Root causes found
1. Frontend `.env` and `.env.sample` used the misspelled backend hostname `world-net-hosting-backtend.vercel.app`.
2. PIN create/verify and PIN-page session validation used single-endpoint fetch calls instead of the project's API candidate/retry helper.
3. The public language/currency widget mounted directly inside `.nav-right`, crowding the top navigation.
4. Backend CORS did not contain the known production frontend origin as a code-level trusted origin.

## Fixes applied
- Corrected backend hostname to `https://world-net-hosting-backend.vercel.app/api`.
- Added build/runtime normalization so the known `backtend` typo is automatically corrected even if an old Vercel environment value remains.
- PIN create, PIN verify and `/auth/me` validation now use the common resilient API request path.
- Improved backend-unreachable error handling instead of exposing raw `Failed to fetch` where possible.
- Added known WNH production frontend origins to backend CORS.
- Moved language/currency controls out of public navigation into a dedicated responsive strip immediately below navigation and above hero/page content.
- Kept dashboard mounting and all admin/staff/user role permissions separate and unchanged.

## Verification
- `node --check frontend/assets/js/app.js` passed.
- `node --check frontend/assets/js/language-switcher.js` passed.
- `node --check frontend/assets/js/env.js` passed.
- `node --check backend/src/server.js` passed.
- Frontend `npm run build` passed.
- Built `dist/assets/js/env.js` resolves to the correct backend URL.
- Backend tests: 3 passed, 0 failed.
- Backend PIN routes confirmed: `/api/auth/me`, `/api/auth/pin/create`, `/api/auth/pin/verify`.

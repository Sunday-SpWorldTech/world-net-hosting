# World Net Hosting — Live Paystack & Services Update

- Added a compact, consistent public **Services** navigation dropdown and a new `services.html` page.
- Reduced desktop navigation spacing without changing the existing color/design system.
- User Banking now exposes dedicated receiving-account details (bank name, account number, account name and currency) when active.
- Added a user-facing **Get Account Number** flow that submits name/email/phone information to the backend and creates a Paystack Dedicated Virtual Account using the backend secret key.
- Added account-number visibility to the main signed-in dashboard and a copy-account-number action on Banking.
- Removed the previous unconditional BVN requirement from the account-creation request. Paystack remains responsible for any provider/category-specific identity validation requirements.
- Hardened environment selection: a deployed `sk_live_...` secret key is treated as live even if a stale `PAYSTACK_ENV` value exists. Explicit test/live calls remain isolated.
- Set the local/sample `PAYSTACK_ENV` default to `live`; API keys remain backend-only and are expected from Vercel environment variables.
- No Paystack secret key was added to frontend code.
- No old payment-provider references were found.

Verification:
- Backend tests: 3/3 passed
- Backend syntax: passed
- Frontend JavaScript syntax: passed
- Frontend production build: passed
- `services.html` included in production build

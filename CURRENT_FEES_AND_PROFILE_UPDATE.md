# World Net Hosting – Profile, Admin Banking, Email and Fee Audit

## User profile settings
- New `profile-settings.html` inside the account dashboard.
- Users can upload/remove a PNG, JPEG or WebP profile photo (max 1.5 MB).
- Users can update name, phone, company, primary login email, password and dashboard PIN.
- Users can add/remove secondary email addresses.
- One primary login email is always required. Secondary emails can also be used to locate the account during authentication.
- Profile/security changes require the current password.

## Email dashboard
- Removed the nested public `email.html` iframe from the dashboard Business Email page.
- Dashboard now has one direct Business Email section rather than displaying the public email page inside a second dashboard page.

## Admin live banking
- Admin WNH Bank now exposes direct Live Paystack Deposit and Live Bank Transfer actions.
- Admin wallet pages can explicitly use the admin token with `?admin=1`.
- Admin system-wallet provider transactions have 0% WNH percentage fee.
- User/reseller transactions retain configured percentage fees.

## Current fee audit
- `USER_PLATFORM_FEE_RATE=0.04` → 4% for normal user transactions where the platform fee is applied.
- Banking Reseller API transaction fee: 4% (same current configured rate); reseller settlement is 96% after the WNH transaction fee.
- Admin system-wallet percentage fee: 0%.
- Domain Reseller API separate percentage fee: 0%.
- Domain customer fixed markup: $8.69 (`DOMAIN_CUSTOMER_MARKUP_USD`). Normal user checkout can additionally apply the 4% user platform fee.
- Email customer fixed markup: $5 by default (`EMAIL_CUSTOMER_MARKUP_USD` fallback). Normal user checkout can additionally apply the 4% user platform fee.
- Reseller Domain wallet purchase records use 0% extra order platform fee; reseller-facing domain prices use the WNH base selling price and the reseller can choose their own external markup.

## Configuration safety
- Existing backend/frontend `.env` and `.env.sample` files were left unchanged.
- Domain API base URL was not changed.

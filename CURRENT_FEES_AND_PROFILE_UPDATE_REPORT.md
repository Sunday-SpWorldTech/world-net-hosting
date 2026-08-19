# World Net Hosting — Profile, Admin Payment and Fee Audit

## Profile settings
- Users can update full name, phone and company.
- Users can upload/remove a profile photo (PNG/JPG/WebP, max 1.5 MB). Photo bytes are stored in MongoDB and are returned only through an authenticated profile-photo endpoint.
- Users can change their primary sign-in email with their current password.
- Users can add up to five additional contact emails and remove those additional emails at any time.
- The primary sign-in email cannot be removed without first changing it to another valid email.
- Users can change password and dashboard PIN from Profile Settings.

## Email section cleanup
- The dashboard Business Email page is now a standalone dashboard page instead of embedding `email.html` in an iframe.
- This removes the duplicated/nested email-page appearance while retaining the public `email.html` page for visitors.

## Admin real payment/transaction access
- Admin WNH Bank includes a Paystack-backed system-wallet payment initializer.
- Admin WNH Bank includes a Paystack-backed bank transfer form using the existing live transfer API.
- Admin Paystack transactions use 0% World Net Hosting platform fee.
- Manual system-wallet adjustments remain clearly labelled as ledger adjustments and are separate from provider-backed payments.

## Current fees / percentages
Based on the current ENV and backend rules:
- User transaction platform fee: **4%** (`USER_PLATFORM_FEE_RATE=0.04`).
- Staff transaction platform fee: **0%** (staff payment/transfer actions do not receive the user fee).
- Admin transaction platform fee: **0%**.
- Reseller Banking API collection fee: **4%** by default; reseller net is **96%** after WNH fee.
- Reseller Domain API platform fee: **0%** and WNH reseller-domain markup: **$0**. Reseller Domain API returns the base WNH/provider selling price and the reseller may choose its own customer markup.
- Main customer domain pricing: provider price plus **$8.69** configured WNH domain markup (`DOMAIN_CUSTOMER_MARKUP_USD=8.69`), not a percentage.
- Business Email markup: **$5.00** default when `EMAIL_CUSTOMER_MARKUP_USD` is not set.
- Admin system-wallet deposits and admin system-wallet bank withdrawals: **0% WNH platform fee**.

`BANKING_API_TRANSACTION_FEE_RATE` is now supported as an optional dedicated backend variable; when absent it safely falls back to `USER_PLATFORM_FEE_RATE`, so the existing ENV remains unchanged and the current Banking API fee remains 4%.

## Preserved configuration
- Domain Name API live base remains exactly `https://api.domainresellerapi.com/api/v1`.
- Existing backend/frontend `.env` and `.env.sample` files were not modified.

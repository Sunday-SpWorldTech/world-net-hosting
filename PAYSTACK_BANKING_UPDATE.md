# Paystack Banking Update

Roles remain exactly: `user`, `staff`, `admin`.

- User/staff bank transfers: requested amount plus `USER_PLATFORM_FEE_RATE` (default 4%).
- Admin system-wallet transfer: real Paystack amount, no platform fee.
- User/staff dedicated receive accounts: incoming amount less 4% platform fee.
- Admin receives through the merchant Paystack collection/settlement account with no platform fee.
- Convert: internal multi-currency wallet ledger using the existing exchange-rate service; 4% for user/staff, no fee for admin.
- Transfer status is reconciled through Paystack `transfer.success`, `transfer.failed`, and `transfer.reversed` webhooks.
- Failed/reversed transfers are automatically refunded once.

Production requirements:
1. Paystack Transfers must be enabled and funded.
2. Dedicated Virtual Accounts must be enabled; customer KYC/consent may be required.
3. Add the backend webhook URL in Paystack.
4. Live API keys are required for real bank movement.

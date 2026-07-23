# World Net Hosting — Withdrawal and Live Chat Audit

Date: 2026-07-16

## Scope preserved

- Existing role enum remains exactly: `user`, `staff`, `admin`.
- Existing authentication, staff permissions, admin access, 4% user fee, domain, hosting, GitHub, wallet deposit, and purchase flows were not renamed or removed.

## Withdrawal update

- Added authenticated personal-wallet withdrawal requests for user, staff, and admin accounts.
- Added separate admin system-wallet withdrawal requests.
- Funds are reserved immediately to prevent double spending.
- Staff with `wallet.manage` permission and admins can approve, mark paid, or reject.
- Rejected requests automatically return reserved funds to the correct wallet.
- Bank account numbers are encrypted at rest and masked in dashboard responses.
- Added payout reference, review note, status history fields, and withdrawal transaction references.
- No external bank payout is falsely claimed: approval and paid status are recorded after the real transfer is completed by the authorized operator.

## Live chat update

- Added compact chat launcher to all frontend HTML pages.
- Users can type or paste text and upload one supported file up to 3 MB.
- Attachments support common images, PDF, DOC/DOCX, and TXT.
- Messages appear in both staff and admin dashboards.
- Existing Azure Translator environment is reused: local-language messages are translated to English; staff/admin English replies are translated back to the conversation language.
- Added Open and Close controls, small up/down chat scroll controls, polling for replies, and status display.
- Existing staff permission `support.manage` remains required for staff conversation management.

## Checks completed

- Backend server syntax: passed.
- Message model syntax: passed.
- Withdrawal model syntax: passed.
- Frontend app JavaScript syntax: passed.
- Backend production dependency audit: 0 vulnerabilities.
- Frontend production dependency audit: 0 vulnerabilities.
- Role enum assertion: passed.
- All frontend HTML pages load the shared chat application script.
- Withdrawal and chat routes confirmed before the API 404 fallback.

## Required Render variable

Add a separate long random secret:

`WITHDRAWAL_ENCRYPTION_KEY=<at least 32 random characters>`

Keep all existing role, MongoDB, JWT, Paystack, GitHub, Domain API, and Azure Translator variables unchanged.

# Domain Availability Fix Audit — 2026-07-16

## Scope
Only the live domain-search availability mapping and result rendering were changed.

## Backend corrections
- Accepts boolean, numeric, and string availability values.
- Supports `available`, `isAvailable`, `canRegister`, `registerable`, `registrable`, `availability`, `availabilityStatus`, `result`, and `status` fields.
- Supports nested provider response wrappers and domain-keyed objects.
- Supports alternative domain and price field names.
- Separates premium status from unavailable/taken status.
- Keeps unavailable domains unavailable; it does not falsely enable purchase.

## Frontend corrections
- Available domains show first-year and renewal pricing plus an Add button.
- Registered domains show Taken and no Add button.
- Premium domains show Premium and no ordinary Add button.
- Unavailable domains no longer display a misleading purchasable price.

## Preserved functionality
Roles, wallets, deposits, withdrawals, staff/admin permissions, chat, translations, GitHub connection, hosting, Paystack, pricing markup, and environment variables were not changed.

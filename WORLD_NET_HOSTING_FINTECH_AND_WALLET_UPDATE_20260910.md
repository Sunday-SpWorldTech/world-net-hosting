
# World Net Hosting – Wallet, Domain and Financial Product Update

## Customer-facing changes
- Removed customer dashboard links for Create Bank Account and Receiving Details.
- Customer wallet UI only displays balances supported by real transaction evidence; zero/unbacked USD is not shown.
- Customer dashboard responses no longer expose admin notes, risk status or staff permissions.
- Domain search no longer returns provider/wholesale price details to customers.
- StroWallet provider cost, keys and raw provider responses remain backend-only.

## Domain pricing
- First year uses the live domain provider price with no WNH first-year markup.
- Renewal uses the live renewal price plus a flat $13 WNH renewal markup.

## StroWallet
- Backend uses the official documented endpoints for Dollar Card, Naira Card and Virtual Bank Account.
- Customer never enters a StroWallet customer ID.
- NIN/BVN is collected by WNH for identity/KYC input; sensitive identity values are encrypted at rest.
- Naira-card creation still depends on StroWallet returning/accepting its required provider customer ID. The backend attempts to obtain one internally; it never asks the user for it and never invents one.
- Public/secret keys are server-side environment variables only.

## Payment fulfillment
- Financial product checkout is Paystack-verified before StroWallet fulfillment.
- Duplicate fulfillment is prevented by the financial service order and payment reference.

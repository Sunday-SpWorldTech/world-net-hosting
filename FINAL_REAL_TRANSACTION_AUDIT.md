# World Net Hosting final transaction audit

- User, staff, and admin role middleware remains unchanged.
- Admin PIN authentication routes remain unchanged.
- `staff.htm` is the staff workspace filename; no `staff.html` reference remains.
- Deposit uses Paystack initialization and credits only after successful verification/webhook.
- Send performs an authenticated wallet-to-wallet debit/credit with the 4% user/staff platform fee.
- Receive uses Paystack dedicated virtual accounts and webhook crediting.
- Transfer and Withdraw use direct Paystack transfer-recipient and transfer APIs; there is no staff/admin approval queue.
- Failed provider transfer initialization automatically restores the debited wallet amount.
- Convert uses live exchange-rate lookup and the 4% user/staff fee.
- Admin system-wallet transfers use the direct Paystack flow with no platform fee.
- Domain checkout includes Paystack and wallet-balance payment methods; wallet checkout includes the 4% platform fee.
- The image logo is not referenced; the interface uses the WNH text mark.
- Language and currency controls remain enabled on public and dashboard pages and persist through local storage.

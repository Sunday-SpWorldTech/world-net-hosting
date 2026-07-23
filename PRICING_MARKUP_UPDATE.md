# WNH Pricing Markup Update

- Domains: first registration uses the live provider price. Renewal/next payment adds **$10 USD** for customer accounts.
- Hosting: every monthly paid hosting subscription adds **$10 USD**, converted to NGN using `FALLBACK_USD_NGN_RATE` for Paystack settlement.
- Business email: every monthly email plan adds **$5 USD**.
- Admin: admin pricing endpoints and hosting subscription calculation use provider/base prices with **0 markup** and **0 platform transaction fee**.
- Customer 4% fee remains separate and applies after the customer subtotal/markup. Admin fee rate is zero.

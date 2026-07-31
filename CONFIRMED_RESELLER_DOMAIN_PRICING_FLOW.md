# Confirmed Reseller Domain Pricing Flow

- The reseller Domain API returns the same World Net Hosting domain selling price used by the main platform.
- That base price is provider price plus the existing `DOMAIN_CUSTOMER_MARKUP_USD` value.
- The reseller chooses any additional markup on the reseller's own platform.
- World Net Hosting does not choose or hardcode the reseller markup.
- Generic Banking API collections no longer use the incorrect 96%/4% split. After verified Paystack success, the collection is credited to the reseller wallet.
- Domain API responses expose `providerPrice`, `worldNetHostingMarkup`, `resellerBasePrice`, and `minimumCustomerPrice` so reseller platforms can calculate their own final customer price.

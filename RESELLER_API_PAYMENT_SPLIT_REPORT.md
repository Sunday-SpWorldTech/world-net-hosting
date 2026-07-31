# Reseller Banking API Transaction Fee Report

- Banking API payments use the confirmed Option B settlement flow.
- World Net Hosting deducts a 4% transaction fee from the verified customer payment.
- The reseller receives the remaining 96% in the reseller World Net Hosting banking wallet.
- Paystack verification is required before either wallet is credited.
- Duplicate webhook deliveries are protected using unique wallet transaction references.
- The fee can be configured with `BANKING_API_TRANSACTION_FEE_RATE`; the default is `0.04`.
- Domain API pricing remains separate and continues to use the same World Net Hosting marked-up domain price shown on the main platform.

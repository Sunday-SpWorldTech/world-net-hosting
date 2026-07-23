# World Net Hosting update completed

- GitHub App callback now rejects a non-production redirect and falls back to the deployed Render frontend.
- Duplicate support chat launcher is prevented.
- Dashboard checkout duplicate Dashboard button was removed.
- Uploaded wallet design was integrated as `dashboard-wallet.html` with the existing dashboard shell.
- Wallet services use authenticated backend banking routes and Paystack configuration.
- Wallet-balance domain checkout was added with the platform's 4% fee.
- Transaction history remains backed only by real API records.
- User overview withdrawal clutter was removed from the overview and moved to the wallet workspace.
- Admin dashboard duplicate system-wallet form was removed.
- User and admin logout now return to the public home page.
- Public `Login/Join Free` labels were changed to `Users/Access`.
- Image logos were replaced with a text-based WNH mark in source pages.
- Dashboard wallet navigation now uses the dedicated wallet page.

Validation completed:
- `npm run check`
- `npm --prefix frontend run build`
- `npm --prefix backend run smoke`

# Complete backend and banking update

- Preserved backend and frontend `.env` and `.env.sample` files.
- Backend now starts its HTTP health endpoint immediately and retries MongoDB instead of crashing the Render service.
- CORS normalizes configured frontend origins.
- Wallet API exposes separate real NGN and USD ledger balances. No converted or fake balance is created.
- Wallet deposit crediting now updates the correct currency ledger.
- User percentage fee remains controlled by `USER_PLATFORM_FEE_RATE`; admin fee remains zero.
- Projects, hosting, domain-search and banking status messages were improved.
- Dedicated IP configuration and user-interface sections were removed.
- `.env.sample` secrets were replaced with safe placeholders.

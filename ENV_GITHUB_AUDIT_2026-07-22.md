# Environment and GitHub Audit — 2026-07-22

- Backend real environment values installed in `backend/.env`.
- Frontend production values installed in `frontend/.env`.
- Fixed malformed `DOMAIN_SEARCH_TLDS` / `DOMAIN_SEARCH_CACHE_MS` line.
- Confirmed exactly 200 TLDs and batch size 100.
- Matched frontend Paystack public key to backend Paystack public key.
- Added `GITHUB_AUTH_CALLBACK_URL` for OAuth login.
- Preserved `GITHUB_CALLBACK_URL` for GitHub App installation completion.
- Validated GitHub RSA private key with OpenSSL.
- Disabled incomplete deployment-worker pair so direct Render deployment is used.
- Confirmed no dedicated-IP request code remains.
- JavaScript syntax checks passed.
- Frontend production build passed before cleanup.

Required GitHub dashboard settings:
- OAuth App callback: `https://world-net-hosting-backend.onrender.com/api/auth/github/callback`
- GitHub App setup URL: `https://world-net-hosting-backend.onrender.com/api/github/callback`
- GitHub App slug: `world-net-hosting`

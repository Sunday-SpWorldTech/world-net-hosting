# Render environment setup

## Backend service
Use Root Directory `backend`, Build Command `npm ci --omit=dev`, Start Command `npm start`, and Health Check Path `/api/health`.

Add these Render environment variables:

### Core backend
- `NODE_ENV=production`
- `MONGODB_URI`
- `JWT_SECRET` (at least 32 characters)
- `FRONTEND_URL=https://world-net-hosting-frontend.onrender.com`
- `BACKEND_URL=https://world-net-hosting-backend.onrender.com`

### GitHub OAuth App — login
- `GITHUB_OAUTH_APP_KEY` = OAuth App Client ID
- `GITHUB_OAUTH_APP_SECRET` = OAuth App Client Secret
- `GITHUB_OAUTH_CALLBACK_URL=https://world-net-hosting-backend.onrender.com/api/auth/github/callback`

Register the same callback URL in GitHub OAuth App settings. It must match exactly.

### GitHub App — repository connection and deployment
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG=world-net-hosting`
- `GITHUB_APP_INSTALL_URL=https://github.com/apps/world-net-hosting/installations/new`
- `GITHUB_PRIVATE_KEY` = complete PEM private key
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_CALLBACK_URL=https://world-net-hosting-backend.onrender.com/api/github/callback`

GitHub App Setup URL: `https://world-net-hosting-backend.onrender.com/api/github/callback`
GitHub App Webhook URL: `https://world-net-hosting-backend.onrender.com/api/github/webhook`

### Domain API
- `DOMAIN_RESELLER_ID`
- `DOMAIN_API_KEY`
- `DOMAIN_API_MODE=live`
- `DOMAIN_SEARCH_BATCH_SIZE=12`

### Paystack banking
- `PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_REQUIRE_LIVE=true`
- `PAYSTACK_CALLBACK_URL=https://world-net-hosting-frontend.onrender.com/payment-success.html`

The backend now remains online when Paystack keys are missing or invalid. Payment endpoints remain unavailable until matching keys are configured.

### Render deployment API
- `RENDER_API_KEY`
- `RENDER_WORKSPACE_ID`
- `RENDER_BACKEND_SERVICE_ID`
- `RENDER_FRONTEND_SERVICE_ID`

## Frontend service
- Root Directory: `frontend`
- Build Command: `npm ci && npm run build`
- Start Command: `node server.js`
- `WORLDNET_API_BASE_URL=https://world-net-hosting-backend.onrender.com/api`
- `WORLDNET_PAYSTACK_PUBLIC_KEY` = same Paystack public key

## Verification order
1. Open `https://world-net-hosting-backend.onrender.com/api/health`.
2. Confirm `database` is `connected`.
3. Confirm `githubOAuthConfigured` is `true` and callback URL is exact.
4. Test GitHub login.
5. Test GitHub App installation and repository list.
6. Test domain search; requests are sent in batches of 12.
7. Test Paystack bank list, account resolution, deposit initialization, and transfer only after live keys are configured.

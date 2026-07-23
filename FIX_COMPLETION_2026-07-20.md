# World Net Hosting repair completion

## Preserved
- Existing user, staff, and admin roles and permission checks.
- Existing hosting subscription and Paystack billing flow.
- Existing wallet ownership and role-based fee rules.

## Updated
- GitHub OAuth login callback now honors `GITHUB_AUTH_CALLBACK_URL` before falling back to `BACKEND_URL`.
- GitHub App configuration endpoint now reports both required callback URLs.
- GitHub repository loading paginates up to 1,000 authorized repositories, removes duplicates, sorts results, and reports suspended installations.
- Create Project now requires a real GitHub connection and loads authorized repositories with visible loading/error states.
- Domain search no longer displays “Searching/Loading 200 domains from backend”.
- Domain results retain Show More and Show Less and distinguish verified results from registry results that were not returned.
- Wallet failure state no longer displays the large “Balance unavailable” wording; it uses a neutral placeholder and retry message.
- Frontend static build copied into `backend/public` so both deployment modes contain the same fixes.

## Required production settings
GitHub OAuth App authorization callback URL:
`https://world-net-hosting-backend.onrender.com/api/auth/github/callback`

GitHub App setup URL / callback URL:
`https://world-net-hosting-backend.onrender.com/api/github/callback`

Render environment variables must match those exact URLs:
- `GITHUB_AUTH_CALLBACK_URL`
- `GITHUB_CALLBACK_URL`
- `BACKEND_URL`
- `FRONTEND_URL`

The domain provider must still authorize the backend's outbound IP. Code cannot bypass a provider IP whitelist.

# Live deployment environment guide

The repository intentionally keeps real secret values out of Git. Use `backend/.env.sample` and `frontend/.env.sample` as the complete key lists, then enter real secret values directly in Render.

## Corrections required before deployment

1. `JWT_SECRET` must contain only the secret. Do not use `JWT_SECRET=JWT_SECRET=...`.
2. The frontend and backend must use the same Paystack public key from the same account and mode as the Paystack secret key.
3. `GITHUB_PRIVATE_KEY` must be the complete PEM private key generated for the GitHub App. A value beginning with `SHA256:` is only a fingerprint and cannot authenticate the app.
4. Do not commit `.env` files. The existing `.gitignore` protects every `.env` file while preserving `.env.sample` and `.env.example`.
5. Real project deployment requires a configured deployment worker URL/token. Leaving `DEPLOYMENT_WORKER_URL` empty means the platform can save projects but cannot actually build and host customer code.
6. Real Paystack transfers and Dedicated Virtual Accounts require those products to be enabled on the Paystack business account.

## Preflight

From the repository root, after setting backend environment variables locally, run:

```powershell
npm run preflight
npm run audit
```

On Render, use the backend health path `/api/health` and test `/api/github/status` after deployment.

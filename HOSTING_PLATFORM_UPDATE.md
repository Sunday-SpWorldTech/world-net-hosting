# World Net Hosting Git Deployment Upgrade

This build adds a separate professional cloud-project module while preserving existing domain, cart, wallet and Paystack routes.

## Added
- Frontend, backend and worker project records
- Encrypted environment-variable storage
- Deployment history and worker readiness checks
- Platform subdomains and custom-domain attachment
- Professional projects dashboard
- GitHub App and deployment-worker environment placeholders

## Production requirement
Customer repositories must run on an isolated deployment worker with Docker or another sandbox. Configure `DEPLOYMENT_WORKER_URL` and `DEPLOYMENT_WORKER_TOKEN`. The current Render API remains the control plane and must not execute untrusted customer code directly.

# World Net Hosting — Hosting Readiness

## Implemented in this project
- GitHub App installation completion and account connection
- Repository listing through short-lived GitHub installation tokens
- HMAC-SHA256 verification for GitHub push webhooks
- Separate frontend, backend and worker project records
- Encrypted environment variables
- Paystack monthly hosting-plan checkout and webhook activation
- Active-plan enforcement before deployment
- Authenticated control-plane to deployment-worker contract
- Docker deployment-worker starter service
- Custom-domain attachment and DNS instructions
- Existing domain purchase, cart, wallet deposit and Paystack order routes remain separate

## Required before real public hosting can be called live
1. Register the World Net Hosting GitHub App and add the environment values.
2. Deploy `deployment-worker/` on a Linux VPS with Docker. Render web services cannot safely run arbitrary customer Docker workloads.
3. Add a reverse proxy such as Traefik or Caddy on the worker/edge server.
4. Point wildcard DNS `*.worldnethosting.com` to the edge server.
5. Implement the worker callback that reports build logs and live/failed status to the control plane.
6. Add a secure installation-token broker for private-repository cloning.
7. Add automatic TLS issuance and renewal for custom domains.
8. Add resource metering, suspension, renewal reminders and abuse controls.

The dashboard must not display a project as live until the worker callback and edge routing confirm it.

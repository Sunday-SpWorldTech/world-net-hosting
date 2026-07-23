# Projects & Hosting repair — 2026-07-23

## Repaired
- Removed cookie-credential mode from cross-origin Projects & Hosting requests.
- Preserved Bearer-token authentication and added admin-token fallback.
- Added explicit JSON Accept header and safe CORS mode.
- Added complete CORS preflight methods and Authorization header support.
- Added an authenticated `/api/hosting/status` diagnostic endpoint.
- Loads configuration, projects, and subscriptions together without duplicate subscription requests.
- Preserved GitHub App, Render deployment, hosting plans, project creation, environment variables, service sync, and deletion flows.
- Rebuilt `frontend/dist` and synchronized `backend/public`.

## Verified locally
- JavaScript syntax checks passed.
- Frontend static production build passed.
- `OPTIONS /api/hosting/projects` returned HTTP 204 with the production frontend origin and Authorization allowed.
- `GET /api/health` returned HTTP 200.

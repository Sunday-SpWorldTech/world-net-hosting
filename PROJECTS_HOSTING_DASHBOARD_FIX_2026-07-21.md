# Projects & Hosting Dashboard Fix

- Embedded every Projects & Hosting page inside the existing customer dashboard shell.
- Preserved the Render-inspired project, repository, deployment and service design.
- Added internal Projects, New Service, Subscriptions and GitHub navigation.
- Added live subscription listing and service-level subscription information.
- Kept instance plans, environment variables, `.env` import, build/start commands, region, branch and advanced settings on the deployment form.
- Added environment-variable summary to service details without exposing secret values.
- Local Vite now uses `http://localhost:10000/api` automatically.
- Added localhost CORS origins for non-production backend development.
- Replaced generic `Failed to fetch` with a clear backend connectivity message.
- Production remains connected to `https://world-net-hosting-backend.onrender.com/api`.
- `npm run check` and the frontend production build pass.

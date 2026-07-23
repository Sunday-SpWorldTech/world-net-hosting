# Projects & Hosting Render-style rebuild

- Replaced modal creation with full-page service workflow.
- Added service type, GitHub repository, deployment configuration, and service detail pages.
- Removed artificial deployment percentages and generated URLs.
- Corrected native Render service payload to include `serviceDetails.envSpecificDetails`.
- Added environment variable import and encryption through existing backend encryption.
- Synchronized frontend source, frontend dist, and backend public copies.
- GitHub OAuth callback remains `/api/auth/github/callback`; GitHub App installation callback remains `/api/github/callback`.

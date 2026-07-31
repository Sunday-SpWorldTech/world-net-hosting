# Render Link Recheck

- Active frontend origin: `https://world-net-hosting-frontend.onrender.com`
- Old `https://worldnethosting.com` URL occurrences: **0**
- Canonical URLs checked in source and generated `dist`: all use the active Render frontend origin.
- Open Graph page URLs checked in source and generated `dist`: all use the active Render frontend origin.
- Sitemap URLs checked in source and generated `dist`: all use the active Render frontend origin.
- The backend API URL remains `https://world-net-hosting-backend.onrender.com/api`, because API requests must point to the backend service, not the frontend service.
- External provider URLs such as Paystack and Domain Reseller API were preserved because replacing them would break the integrations.
- `npm run check`: passed.
- `npm --prefix frontend run build`: passed.

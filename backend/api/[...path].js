// Vercel catch-all serverless entry for every /api/* request.
// Export the same Express application so routes such as /api/health,
// /api/domains/search and /api/reseller/* reach src/server.js.
const app = require('../src/server');
module.exports = app;

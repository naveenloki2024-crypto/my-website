// Vercel serverless entrypoint.
// The full Express app (API routes + static files in /public) is exported so
// Vercel's Node runtime can serve it as a single serverless function.
// vercel.json rewrites every request to this function.

module.exports = require('../app');
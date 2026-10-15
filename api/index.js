// Placeholder so Vercel detects the API function before the build runs.
// `npm run build:api` (part of the Vercel build command) overwrites this file
// with the bundled Hono app from server/src/vercel-handler.ts.
const notBuilt = () =>
  new Response(JSON.stringify({ error: 'API bundle not built' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })

export const GET = notBuilt
export const POST = notBuilt
export const PUT = notBuilt
export const PATCH = notBuilt
export const DELETE = notBuilt
export const OPTIONS = notBuilt
export default { fetch: notBuilt }

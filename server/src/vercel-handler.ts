import { app } from './app.ts'

async function fetch(request: Request): Promise<Response> {
  return app.fetch(request)
}

export { fetch }
export const GET = fetch
export const POST = fetch
export const PUT = fetch
export const PATCH = fetch
export const DELETE = fetch
export const OPTIONS = fetch
export default { fetch }

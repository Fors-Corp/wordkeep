import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { app } from './app.ts'
import { ensureLanguages } from './languages.ts'
import { warmupSuggestBanks } from './suggest.ts'

export { app }

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
const here = dirname(fileURLToPath(import.meta.url))
const clientDist = process.env.CLIENT_DIST ?? join(here, '../../client/dist')

if (existsSync(join(clientDist, 'index.html'))) {
  const indexHtml = readFileSync(join(clientDist, 'index.html'), 'utf8')
  app.use('/*', serveStatic({ root: clientDist }))
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404)
    return c.html(indexHtml)
  })
}


if (!process.env.WORDKEEP_SKIP_WARMUP) {
  ensureLanguages()
    .then(() => warmupSuggestBanks(['en', 'es', 'fr', 'it', 'de', 'pt']))
    .catch(() => undefined)
}

if (!process.env.WORDKEEP_TEST) {
  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`Wordkeep on http://${info.address}:${info.port}`)
  })
}

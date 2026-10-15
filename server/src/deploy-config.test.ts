import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const root = new URL('../../', import.meta.url)
const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8')) as {
  rewrites: Array<{ source: string; destination: string }>
}
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { scripts: Record<string, string> }

describe('Vercel deploy config', () => {
  it('bundles the API into the single function the rewrites point at', () => {
    assert.match(pkg.scripts['build:api'] ?? '', /--outfile=api\/index\.js\b/)
  })

  it('sends every nested /api path to that function before the SPA fallback', () => {
    const first = vercel.rewrites[0]
    assert.deepEqual(first, { source: '/api/(.*)', destination: '/api' })
    const spa = vercel.rewrites.find((rule) => rule.destination === '/index.html')
    assert.ok(spa && !new RegExp(`^${spa.source}$`).test('/api/phrase/analyze'))
  })
})

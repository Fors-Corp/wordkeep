import './test/db-env.ts'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { app } from './app.ts'
import { db } from './db.ts'
import { clearLookupCache } from './lookup.ts'
import { installDictionaryMock } from './test/fixtures.ts'

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>
}

describe('API integration', () => {
  afterEach(() => {
    clearLookupCache()
  })

  it('GET /api/health', async () => {
    const res = await app.request('/api/health')
    assert.equal(res.status, 200)
    const body = await json(res)
    assert.equal(body.ok, true)
    assert.equal(typeof body.version, 'string')
  })

  it('GET /api/lookup validates q and serves a mocked entry', async () => {
    const missing = await app.request('/api/lookup')
    assert.equal(missing.status, 400)

    const restore = installDictionaryMock()
    try {
      const res = await app.request('/api/lookup?q=happy&lang=en')
      assert.equal(res.status, 200)
      const body = await json(res)
      assert.equal(body.displayLemma, 'happy')
      assert.equal(body.existing, null)
    } finally {
      restore()
    }
  })

  it('GET /api/suggest with empty q', async () => {
    const res = await app.request('/api/suggest')
    assert.equal(res.status, 200)
    assert.deepEqual(await json(res), { query: '', detected: [], suggestions: [] })
  })

  it('no longer serves lexicon storage routes', async () => {
    for (const path of ['/api/words', '/api/stats', '/api/review/queue', '/api/graph']) {
      assert.equal((await app.request(path)).status, 404, path)
    }
  })

  it('rejects language codes that are not plain codes', async () => {
    const attacks = [
      'evil.example/x?',
      '169.254.169.254#',
      'en.wiktionary.org#|^(\\w+\\s?)+$',
      '../../../../etc/passwd',
    ]
    for (const lang of attacks) {
      for (const path of ['/api/lookup?q=cat&lang=', '/api/play/round?lang=', '/api/phrase/analyze?q=a%20cat&lang=']) {
        const res = await app.request(path + encodeURIComponent(lang))
        assert.equal(res.status, 400, path + lang)
        assert.equal((await json(res)).code, 'bad-lang')
      }
    }
    const suggest = await app.request(`/api/suggest?q=cat&ui=${encodeURIComponent('../x')}`)
    assert.equal(suggest.status, 400)
  })

  it('rejects overlong lookups and oversized bodies', async () => {
    const long = await app.request(`/api/lookup?q=${'a'.repeat(200)}&lang=en`)
    assert.equal(long.status, 400)
    assert.equal((await json(long)).code, 'query-too-long')

    const big = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'x'.repeat(200_000) }),
    })
    assert.equal(big.status, 413)
  })

  it('no longer serves the unused play bank route', async () => {
    assert.equal((await app.request('/api/play/bank?lang=en')).status, 404)
  })
})

describe('legacy export', () => {
  it('returns an empty v1 backup when the old tables are absent', async () => {
    db.exec('DROP TABLE IF EXISTS word_links')
    db.exec('DROP TABLE IF EXISTS senses')
    db.exec('DROP TABLE IF EXISTS words')
    const body = (await (await app.request('/api/legacy/export')).json()) as { version: number; words: unknown[] }
    assert.equal(body.version, 1)
    assert.deepEqual(body.words, [])
  })

  it('hands over rows from the old tables', async () => {
    db.exec(`CREATE TABLE words (id TEXT PRIMARY KEY, lemma TEXT, display_lemma TEXT, language TEXT)`)
    db.exec(`CREATE TABLE senses (id TEXT PRIMARY KEY, word_id TEXT, definition TEXT)`)
    db.exec(`CREATE TABLE word_links (id TEXT PRIMARY KEY, from_word_id TEXT)`)
    db.exec(`INSERT INTO words VALUES ('w1', 'happy', 'happy', 'en')`)
    db.exec(`INSERT INTO senses VALUES ('s1', 'w1', 'Glad.')`)
    try {
      const body = (await (await app.request('/api/legacy/export')).json()) as {
        words: Array<{ id: string }>
        senses: unknown[]
      }
      assert.deepEqual(
        body.words.map((row) => row.id),
        ['w1'],
      )
      assert.equal(body.senses.length, 1)

      // Once a device confirms it saved them, they are not handed out again.
      assert.equal((await app.request('/api/legacy/ack', { method: 'POST' })).status, 200)
      const after = (await (await app.request('/api/legacy/export')).json()) as { words: unknown[] }
      assert.deepEqual(after.words, [])
    } finally {
      db.exec('DROP TABLE IF EXISTS legacy_handover')
      db.exec('DROP TABLE word_links')
      db.exec('DROP TABLE senses')
      db.exec('DROP TABLE words')
    }
  })
})

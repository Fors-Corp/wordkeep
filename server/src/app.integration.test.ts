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

  it('play bank reports size for a language', async () => {
    const res = await app.request('/api/play/bank?lang=en')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { bankSize: number }
    assert.equal(typeof body.bankSize, 'number')
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
    } finally {
      db.exec('DROP TABLE word_links')
      db.exec('DROP TABLE senses')
      db.exec('DROP TABLE words')
    }
  })
})

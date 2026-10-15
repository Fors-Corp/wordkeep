import './test/db-env.ts'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { entryFromLookup, tombstone, withPatch, type StoredEntry } from '../../shared/lexicon.ts'
import { createSyncKey, formatSyncKey } from '../../shared/sync.ts'
import { app } from './app.ts'
import { db } from './db.ts'
import { spaceFor, syncBackend } from './sync.ts'
import { lookupFixture } from './test/fixtures.ts'

type SyncResponse = { cursor: number; changes: StoredEntry[]; more: boolean; code?: string }

async function sync(body: unknown): Promise<{ status: number; body: SyncResponse }> {
  const res = await app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as SyncResponse }
}

const saved = { ...process.env }

describe('sync', () => {
  beforeEach(() => {
    syncBackend()
    db.exec('DELETE FROM sync_records')
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  })

  it('moves records between two devices that share a code', async () => {
    const key = createSyncKey()
    const happy = entryFromLookup(lookupFixture(), { now: 1000, id: 'w-happy' })

    const first = await sync({ key, since: 0, changes: [happy] })
    assert.equal(first.status, 200)
    assert.equal(first.body.cursor, 1)

    const other = await sync({ key: formatSyncKey(key).toLowerCase(), since: 0, changes: [] })
    assert.deepEqual(
      other.body.changes.map((entry) => entry.id),
      ['w-happy'],
    )
    assert.equal(other.body.changes[0]!.displayLemma, 'happy')

    const nothingNew = await sync({ key, since: other.body.cursor, changes: [] })
    assert.deepEqual(nothingNew.body.changes, [])

    const stranger = await sync({ key: createSyncKey(), since: 0, changes: [] })
    assert.deepEqual(stranger.body.changes, [])
  })

  it('keeps the newest copy of a record and syncs deletions', async () => {
    const key = createSyncKey()
    const original = entryFromLookup(lookupFixture(), { now: 1000, id: 'w1' })
    await sync({ key, since: 0, changes: [withPatch(original, { note: 'new' }, 3000)] })
    await sync({ key, since: 0, changes: [withPatch(original, { note: 'old' }, 2000)] })
    let pulled = await sync({ key, since: 0, changes: [] })
    assert.equal(pulled.body.changes[0]!.note, 'new')

    await sync({ key, since: 0, changes: [tombstone(pulled.body.changes[0]!, 4000)] })
    pulled = await sync({ key, since: 0, changes: [] })
    assert.equal(pulled.body.changes[0]!.deletedAt, 4000)
  })

  it('pages through large pulls', async () => {
    const key = createSyncKey()
    const many = Array.from({ length: 501 }, (_, i) =>
      entryFromLookup(lookupFixture({ lemma: `w${i}`, displayLemma: `w${i}` }), { now: 1000, id: `id-${i}` }),
    )
    assert.equal((await sync({ key, since: 0, changes: many.slice(0, 500) })).status, 200)
    const first = await sync({ key, since: 0, changes: many.slice(500) })
    assert.equal(first.body.changes.length, 500)
    assert.equal(first.body.more, true)
    const second = await sync({ key, since: first.body.cursor, changes: [] })
    assert.equal(second.body.changes.length, 1)
    assert.equal(second.body.more, false)
  })

  it('rejects bad codes, bad records, and oversized batches', async () => {
    assert.equal((await sync({ key: 'nope', changes: [] })).body.code, 'sync-bad-key')
    assert.equal((await sync({ key: createSyncKey(), changes: [{ id: 1 }] })).body.code, 'sync-bad-record')
    const tooMany = Array.from({ length: 501 }, (_, i) => entryFromLookup(lookupFixture(), { id: `x${i}` }))
    assert.equal((await sync({ key: createSyncKey(), changes: tooMany })).status, 413)
  })

  it('never stores the code itself', async () => {
    const key = createSyncKey()
    await sync({ key, changes: [entryFromLookup(lookupFixture(), { id: 'w1' })] })
    const spaces = db.prepare('SELECT DISTINCT space FROM sync_records').all() as Array<{ space: string }>
    assert.deepEqual(
      spaces.map((row) => row.space),
      [spaceFor(key)],
    )
    assert.ok(!spaces[0]!.space.includes(key))
  })

  it('is off on Vercel without Turso, and uses Turso when configured', async () => {
    process.env.VERCEL = '1'
    assert.equal(syncBackend(), null)
    assert.equal((await sync({ key: createSyncKey(), changes: [] })).body.code, 'sync-unavailable')
    process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io'
    process.env.TURSO_AUTH_TOKEN = 'token'
    assert.equal(syncBackend()?.kind, 'turso')
  })
})

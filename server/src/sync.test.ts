import './test/db-env.ts'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { entryFromLookup, tombstone, withPatch, type StoredEntry } from '../../shared/lexicon.ts'
import { createSyncKey, formatSyncKey } from '../../shared/sync.ts'
import { app } from './app.ts'
import { db } from './db.ts'
import { spaceFor, syncBackend } from './sync.ts'
import { lookupFixture } from './test/fixtures.ts'

type SyncResponse = {
  cursor: number
  changes: StoredEntry[]
  more: boolean
  reset?: boolean
  epoch?: string
  code?: string
}

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

  it('sends a pushed record back when the server already has a newer copy', async () => {
    const key = createSyncKey()
    const base = entryFromLookup(lookupFixture(), { now: 1000, id: 'w1' })
    await sync({ key, since: 0, changes: [withPatch(base, { note: 'from the laptop' }, 5000)] })
    const phone = await sync({ key, since: 0, changes: [] })
    // The phone's clock runs behind: its edit is older than the copy it already has.
    const late = await sync({ key, since: phone.body.cursor, changes: [withPatch(base, { note: 'from the phone' }, 4000)] })
    assert.deepEqual(
      late.body.changes.map((entry) => entry.note),
      ['from the laptop'],
    )
  })

  it('tells a device to start over when its cursor is past anything handed out', async () => {
    const key = createSyncKey()
    await sync({ key, since: 0, changes: [entryFromLookup(lookupFixture(), { now: 1000, id: 'w1' })] })
    const ahead = await sync({ key, since: 1200, changes: [] })
    assert.equal(ahead.status, 200)
    assert.deepEqual({ ...ahead.body, epoch: undefined }, { cursor: 0, changes: [], more: false, reset: true, epoch: undefined })
    const fresh = await sync({ key, since: 0, changes: [] })
    assert.equal(fresh.body.changes.length, 1)
    assert.equal(typeof fresh.body.epoch, 'string')

    // A cursor from another database (its epoch differs) also starts over, even when it is small.
    const elsewhere = await sync({ key, since: 1, epoch: 'another-database', changes: [] })
    assert.equal(elsewhere.body.reset, true)
    const same = await sync({ key, since: 1, epoch: fresh.body.epoch, changes: [] })
    assert.equal(same.body.reset, undefined)
  })

  it('counts only new live records toward the cap', async () => {
    const key = createSyncKey()
    const space = spaceFor(key)
    const insert = db.prepare('INSERT INTO sync_records (space, id, updated_at, seq, data) VALUES (?, ?, ?, ?, ?)')
    const filler = JSON.stringify({ deletedAt: null })
    db.exec('BEGIN')
    for (let i = 0; i < 19_999; i += 1) insert.run(space, `f${i}`, 1, i + 1, filler)
    db.exec('COMMIT')
    const existing = entryFromLookup(lookupFixture(), { now: 1000, id: 'f0' })
    const fresh = (id: string) => entryFromLookup(lookupFixture(), { now: 1000, id })
    // Editing or deleting records that are already there always fits.
    assert.equal((await sync({ key, since: 0, changes: [withPatch(existing, { note: 'x' }, 2000)] })).status, 200)
    assert.equal((await sync({ key, since: 0, changes: [tombstone(fresh('f1'), 3000)] })).status, 200)
    // f1 is deleted now, so two new records fit in the space it left.
    assert.equal((await sync({ key, since: 0, changes: [fresh('n1'), fresh('n2')] })).status, 200)
    const full = await sync({ key, since: 0, changes: [fresh('n3')] })
    assert.equal(full.status, 413)
    assert.equal(full.body.code, 'sync-full')
  })

  it('cleans up records before storing them', async () => {
    const key = createSyncKey()
    const entry = { ...entryFromLookup(lookupFixture(), { now: 1000, id: 'w1' }), links: [{ relation: 'synonym' }] }
    delete (entry as Partial<StoredEntry>).easeFactor
    assert.equal((await sync({ key, since: 0, changes: [entry] })).status, 200)
    const [stored] = (await sync({ key, since: 0, changes: [] })).body.changes
    assert.deepEqual(stored!.links, [])
    assert.equal(stored!.easeFactor, 2.5)
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

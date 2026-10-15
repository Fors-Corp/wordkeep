import { createHash, randomUUID } from 'node:crypto'
import { createClient, type Client } from '@libsql/client/web'
import type { Context } from 'hono'
import { normalizeEntry, type StoredEntry } from '../../shared/lexicon.ts'
import { normalizeSyncKey } from '../../shared/sync.ts'
import { db } from './db.ts'

/**
 * Sync between a reader's devices. Each device keeps its whole lexicon
 * locally and exchanges changed records here: last write wins per record.
 * Records are grouped by a space derived from the reader's private sync code;
 * the code itself is never stored.
 */

const MAX_CHANGES = 500
const MAX_RECORD_BYTES = 200_000
const MAX_RECORDS_PER_SPACE = 20_000
const PULL_LIMIT = 500

type Row = { seq: number; data: string }
type Stored = { id: string; updatedAt: number; live: boolean; data: string }

interface SyncBackend {
  kind: 'turso' | 'sqlite'
  /** A random id for this database, made once. A new one means the store was replaced. */
  epoch(): Promise<string>
  apply(space: string, changes: Array<{ id: string; updatedAt: number; data: string }>): Promise<void>
  pull(space: string, since: number, limit: number): Promise<Row[]>
  /** Records in the space that are not deleted. */
  liveCount(space: string): Promise<number>
  /** The highest sequence number handed out in the space, 0 when empty. */
  maxSeq(space: string): Promise<number>
  /** The stored copies of these ids. */
  find(space: string, ids: string[]): Promise<Stored[]>
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sync_records (
    space TEXT NOT NULL,
    id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (space, id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sync_seq ON sync_records (space, seq)`,
  `CREATE TABLE IF NOT EXISTS sync_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)`,
]

const EPOCH_INSERT = `INSERT OR IGNORE INTO sync_meta (name, value) VALUES ('epoch', ?)`
const EPOCH_SELECT = `SELECT value FROM sync_meta WHERE name = 'epoch'`

// Newer copies win; every accepted write gets the space's next sequence number,
// so a device can ask for "everything after the last number I saw".
const UPSERT = `INSERT INTO sync_records (space, id, updated_at, seq, data)
  VALUES (?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM sync_records WHERE space = ?), ?)
  ON CONFLICT (space, id) DO UPDATE SET
    updated_at = excluded.updated_at, seq = excluded.seq, data = excluded.data
  WHERE excluded.updated_at > sync_records.updated_at`

const PULL = `SELECT seq, data FROM sync_records WHERE space = ? AND seq > ? ORDER BY seq LIMIT ?`
const LIVE_COUNT = `SELECT COUNT(*) AS n FROM sync_records
  WHERE space = ? AND json_extract(data, '$.deletedAt') IS NULL`
const MAX_SEQ = `SELECT COALESCE(MAX(seq), 0) AS n FROM sync_records WHERE space = ?`
const findSql = (count: number) =>
  `SELECT id, updated_at, json_extract(data, '$.deletedAt') IS NULL AS live, data FROM sync_records
  WHERE space = ? AND id IN (${Array.from({ length: count }, () => '?').join(', ')})`

function toStored(row: Record<string, unknown>): Stored {
  return { id: String(row.id), updatedAt: Number(row.updated_at), live: Number(row.live) === 1, data: String(row.data) }
}

function tursoBackend(url: string, authToken: string): SyncBackend {
  const client: Client = createClient({ url, authToken })
  let ready: Promise<unknown> | null = null
  // Created once per instance; a failed attempt is retried on the next request.
  const init = () =>
    (ready ??= client.batch(SCHEMA, 'write').catch((error: unknown) => {
      ready = null
      throw error
    }))
  let epoch: string | null = null
  return {
    kind: 'turso',
    async epoch() {
      await init()
      if (epoch) return epoch
      const [, result] = await client.batch(
        [{ sql: EPOCH_INSERT, args: [randomUUID()] }, { sql: EPOCH_SELECT, args: [] }],
        'write',
      )
      epoch = String(result?.rows[0]?.value ?? '')
      return epoch
    },
    async apply(space, changes) {
      await init()
      if (!changes.length) return
      await client.batch(
        changes.map((change) => ({ sql: UPSERT, args: [space, change.id, change.updatedAt, space, change.data] })),
        'write',
      )
    },
    async pull(space, since, limit) {
      await init()
      const result = await client.execute({ sql: PULL, args: [space, since, limit] })
      return result.rows.map((row) => ({ seq: Number(row.seq), data: String(row.data) }))
    },
    async liveCount(space) {
      await init()
      const result = await client.execute({ sql: LIVE_COUNT, args: [space] })
      return Number(result.rows[0]?.n ?? 0)
    },
    async maxSeq(space) {
      await init()
      const result = await client.execute({ sql: MAX_SEQ, args: [space] })
      return Number(result.rows[0]?.n ?? 0)
    },
    async find(space, ids) {
      await init()
      if (!ids.length) return []
      const result = await client.execute({ sql: findSql(ids.length), args: [space, ...ids] })
      return result.rows.map((row) => toStored(row as unknown as Record<string, unknown>))
    },
  }
}

function sqliteBackend(): SyncBackend {
  for (const statement of SCHEMA) db.exec(statement)
  const upsert = db.prepare(UPSERT)
  const pull = db.prepare(PULL)
  const liveCount = db.prepare(LIVE_COUNT)
  const maxSeq = db.prepare(MAX_SEQ)
  db.prepare(EPOCH_INSERT).run(randomUUID())
  const epoch = String((db.prepare(EPOCH_SELECT).get() as { value: string }).value)
  return {
    kind: 'sqlite',
    async epoch() {
      return epoch
    },
    async apply(space, changes) {
      db.exec('BEGIN')
      try {
        for (const change of changes) upsert.run(space, change.id, change.updatedAt, space, change.data)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    async pull(space, since, limit) {
      return (pull.all(space, since, limit) as Row[]).map((row) => ({ seq: Number(row.seq), data: String(row.data) }))
    },
    async liveCount(space) {
      return Number((liveCount.get(space) as { n: number }).n)
    },
    async maxSeq(space) {
      return Number((maxSeq.get(space) as { n: number }).n)
    },
    async find(space, ids) {
      if (!ids.length) return []
      return (db.prepare(findSql(ids.length)).all(space, ...ids) as Array<Record<string, unknown>>).map(toStored)
    },
  }
}

let cached: { signature: string; backend: SyncBackend | null } | null = null

/** Turso when configured; this server's SQLite otherwise, except on Vercel where /tmp is per instance. */
export function syncBackend(): SyncBackend | null {
  const url = process.env.TURSO_DATABASE_URL?.trim()
  const token = process.env.TURSO_AUTH_TOKEN?.trim() ?? ''
  const signature = url ? `turso|${url}|${token}` : process.env.VERCEL ? 'none' : 'sqlite'
  if (cached?.signature !== signature) {
    cached = {
      signature,
      backend: url ? tursoBackend(url, token) : process.env.VERCEL ? null : sqliteBackend(),
    }
  }
  return cached.backend
}

export function spaceFor(key: string): string {
  return createHash('sha256').update(`wordkeep-sync:${key}`).digest('hex')
}

type SyncBody = { key?: unknown; since?: unknown; changes?: unknown; epoch?: unknown }

export async function handleSync(c: Context) {
  const backend = syncBackend()
  if (!backend) {
    return c.json({ error: 'Sync is not set up on this server', code: 'sync-unavailable' }, 503)
  }
  const body = (await c.req.json().catch(() => null)) as SyncBody | null
  const key = typeof body?.key === 'string' ? normalizeSyncKey(body.key) : null
  if (!key) return c.json({ error: 'Invalid sync code', code: 'sync-bad-key' }, 400)
  const since = typeof body?.since === 'number' && body.since >= 0 ? Math.floor(body.since) : 0
  const raw = Array.isArray(body?.changes) ? body.changes : []
  if (raw.length > MAX_CHANGES) return c.json({ error: 'Too much at once', code: 'sync-too-large' }, 413)

  // Newest copy per id, each one checked and filled the same way devices read them.
  const byId = new Map<string, StoredEntry>()
  for (const item of raw) {
    const entry = normalizeEntry(item)
    if (!entry) return c.json({ error: 'Invalid record', code: 'sync-bad-record' }, 400)
    const seen = byId.get(entry.id)
    if (!seen || seen.updatedAt < entry.updatedAt) byId.set(entry.id, entry)
  }
  const changes: Array<{ id: string; updatedAt: number; data: string }> = []
  for (const entry of byId.values()) {
    const data = JSON.stringify(entry)
    if (data.length > MAX_RECORD_BYTES) return c.json({ error: 'Record too large', code: 'sync-too-large' }, 413)
    changes.push({ id: entry.id, updatedAt: entry.updatedAt, data })
  }

  const space = spaceFor(key)
  try {
    // The device read from another store (wiped, or moved to a new database),
    // or its cursor is past anything handed out here: it starts over.
    const epoch = await backend.epoch()
    const knownEpoch = typeof body?.epoch === 'string' ? body.epoch : null
    const reset = since > 0 && ((knownEpoch !== null && knownEpoch !== epoch) || since > (await backend.maxSeq(space)))
    const existing = new Map((await backend.find(space, [...byId.keys()])).map((row) => [row.id, row]))
    // Only records that would become new, undeleted rows count toward the cap.
    const growth = changes.filter((change) => !byId.get(change.id)!.deletedAt && !existing.get(change.id)?.live).length
    if (growth && (await backend.liveCount(space)) + growth > MAX_RECORDS_PER_SPACE) {
      return c.json({ error: 'This lexicon is full', code: 'sync-full' }, 413)
    }
    await backend.apply(space, changes)
    if (reset) return c.json({ cursor: 0, changes: [], more: false, reset: true, epoch })

    const rows = await backend.pull(space, since, PULL_LIMIT)
    const entries = rows.map((row) => JSON.parse(row.data) as StoredEntry)
    // A pushed record that lost to a newer copy is sent back, even if the
    // device's cursor is already past that copy, so the device takes it.
    const pulled = new Set(entries.map((entry) => entry.id))
    for (const change of changes) {
      const kept = existing.get(change.id)
      if (kept && kept.updatedAt > change.updatedAt && !pulled.has(change.id)) {
        entries.push(JSON.parse(kept.data) as StoredEntry)
      }
    }
    const cursor = rows.length ? rows[rows.length - 1]!.seq : since
    return c.json({ cursor, changes: entries, more: rows.length === PULL_LIMIT, epoch })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    return c.json({ error: message, code: 'sync-failed' }, 502)
  }
}

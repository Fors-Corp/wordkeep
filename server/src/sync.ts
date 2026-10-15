import { createHash } from 'node:crypto'
import { createClient, type Client } from '@libsql/client/web'
import type { Context } from 'hono'
import { isStoredEntry, type StoredEntry } from '../../shared/lexicon.ts'
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

interface SyncBackend {
  kind: 'turso' | 'sqlite'
  apply(space: string, changes: Array<{ id: string; updatedAt: number; data: string }>): Promise<void>
  pull(space: string, since: number, limit: number): Promise<Row[]>
  count(space: string): Promise<number>
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
]

// Newer copies win; every accepted write gets the space's next sequence number,
// so a device can ask for "everything after the last number I saw".
const UPSERT = `INSERT INTO sync_records (space, id, updated_at, seq, data)
  VALUES (?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM sync_records WHERE space = ?), ?)
  ON CONFLICT (space, id) DO UPDATE SET
    updated_at = excluded.updated_at, seq = excluded.seq, data = excluded.data
  WHERE excluded.updated_at > sync_records.updated_at`

const PULL = `SELECT seq, data FROM sync_records WHERE space = ? AND seq > ? ORDER BY seq LIMIT ?`
const COUNT = `SELECT COUNT(*) AS n FROM sync_records WHERE space = ?`

function tursoBackend(url: string, authToken: string): SyncBackend {
  const client: Client = createClient({ url, authToken })
  let ready: Promise<unknown> | null = null
  // Created once per instance; a failed attempt is retried on the next request.
  const init = () =>
    (ready ??= client.batch(SCHEMA, 'write').catch((error: unknown) => {
      ready = null
      throw error
    }))
  return {
    kind: 'turso',
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
    async count(space) {
      await init()
      const result = await client.execute({ sql: COUNT, args: [space] })
      return Number(result.rows[0]?.n ?? 0)
    },
  }
}

function sqliteBackend(): SyncBackend {
  for (const statement of SCHEMA) db.exec(statement)
  const upsert = db.prepare(UPSERT)
  const pull = db.prepare(PULL)
  const count = db.prepare(COUNT)
  return {
    kind: 'sqlite',
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
    async count(space) {
      return Number((count.get(space) as { n: number }).n)
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

type SyncBody = { key?: unknown; since?: unknown; changes?: unknown }

export async function handleSync(c: Context) {
  const backend = syncBackend()
  if (!backend) {
    return c.json({ error: 'Sync is not set up on this server', code: 'sync-unavailable' }, 503)
  }
  const length = Number(c.req.header('content-length') ?? 0)
  if (length > 8_000_000) return c.json({ error: 'Too much at once', code: 'sync-too-large' }, 413)

  const body = (await c.req.json().catch(() => null)) as SyncBody | null
  const key = typeof body?.key === 'string' ? normalizeSyncKey(body.key) : null
  if (!key) return c.json({ error: 'Invalid sync code', code: 'sync-bad-key' }, 400)
  const since = typeof body?.since === 'number' && body.since >= 0 ? Math.floor(body.since) : 0
  const raw = Array.isArray(body?.changes) ? body.changes : []
  if (raw.length > MAX_CHANGES) return c.json({ error: 'Too much at once', code: 'sync-too-large' }, 413)

  const changes: Array<{ id: string; updatedAt: number; data: string }> = []
  for (const item of raw) {
    if (!isStoredEntry(item) || typeof item.updatedAt !== 'number') {
      return c.json({ error: 'Invalid record', code: 'sync-bad-record' }, 400)
    }
    const data = JSON.stringify(item)
    if (data.length > MAX_RECORD_BYTES) return c.json({ error: 'Record too large', code: 'sync-too-large' }, 413)
    changes.push({ id: item.id, updatedAt: item.updatedAt, data })
  }

  const space = spaceFor(key)
  try {
    if (changes.length && (await backend.count(space)) + changes.length > MAX_RECORDS_PER_SPACE) {
      return c.json({ error: 'This lexicon is full', code: 'sync-full' }, 413)
    }
    await backend.apply(space, changes)
    const rows = await backend.pull(space, since, PULL_LIMIT)
    const entries = rows.map((row) => JSON.parse(row.data) as StoredEntry)
    const cursor = rows.length ? rows[rows.length - 1]!.seq : since
    return c.json({ cursor, changes: entries, more: rows.length === PULL_LIMIT })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    return c.json({ error: message, code: 'sync-failed' }, 502)
  }
}

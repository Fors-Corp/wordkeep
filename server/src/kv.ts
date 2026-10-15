import { db } from './db.ts'

/**
 * Tiny key-value store with expiry for rate limits and the analysis cache.
 * Uses Upstash Redis (REST) when configured, so every serverless instance
 * shares the same counters; otherwise the local SQLite database.
 */
export type Store = {
  kind: 'redis' | 'sqlite'
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  incr(key: string, ttlSeconds: number): Promise<number>
}

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`)

function sqliteStore(): Store {
  const prune = db.prepare('DELETE FROM kv WHERE key = ? AND expires_at <= ?')
  return {
    kind: 'sqlite',
    async get(key) {
      const row = db.prepare('SELECT value, expires_at FROM kv WHERE key = ?').get(key) as
        | { value: string; expires_at: number }
        | undefined
      if (!row || row.expires_at <= Date.now()) return null
      return row.value
    },
    async set(key, value, ttlSeconds) {
      db.prepare(
        `INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      ).run(key, value, Date.now() + ttlSeconds * 1000)
    },
    async incr(key, ttlSeconds) {
      const now = Date.now()
      prune.run(key, now)
      const row = db
        .prepare(
          `INSERT INTO kv (key, value, expires_at) VALUES (?, '1', ?)
           ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
           RETURNING value`,
        )
        .get(key, now + ttlSeconds * 1000) as { value: string }
      if (Math.random() < 0.01) db.prepare('DELETE FROM kv WHERE expires_at <= ?').run(now)
      return Number(row.value)
    },
  }
}

function redisStore(url: string, token: string): Store {
  async function pipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
    const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`Redis request failed (${res.status})`)
    const body = (await res.json()) as Array<{ result?: unknown; error?: string }>
    return body.map((item) => {
      if (item.error) throw new Error(`Redis error: ${item.error}`)
      return item.result
    })
  }
  return {
    kind: 'redis',
    async get(key) {
      const [value] = await pipeline([['GET', key]])
      return typeof value === 'string' ? value : null
    },
    async set(key, value, ttlSeconds) {
      await pipeline([['SET', key, value, 'EX', ttlSeconds]])
    },
    async incr(key, ttlSeconds) {
      const [count] = await pipeline([
        ['INCR', key],
        ['EXPIRE', key, ttlSeconds, 'NX'],
      ])
      return Number(count)
    },
  }
}

export function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  return url && token ? { url, token } : null
}

let cached: { signature: string; store: Store } | null = null

export function getStore(): Store {
  const redis = redisConfig()
  const signature = redis ? `${redis.url}|${redis.token}` : 'sqlite'
  if (cached?.signature !== signature) {
    cached = { signature, store: redis ? redisStore(redis.url, redis.token) : sqliteStore() }
  }
  return cached.store
}

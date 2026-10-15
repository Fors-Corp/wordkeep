import { createHash } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import type { PhraseNotice } from '../../shared/types.ts'
import { getStore } from './kv.ts'

const DAY_TTL = 2 * 24 * 60 * 60

export type AiAllowance =
  | { ok: true }
  | { ok: false; reason: 'visitor' | 'total' | 'unavailable'; message: string; notice: PhraseNotice }

function limit(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback
}

export function aiLimits() {
  return {
    perVisitor: limit('WORDKEEP_AI_DAILY_PER_VISITOR', 10),
    total: limit('WORDKEEP_AI_DAILY_TOTAL', 100),
  }
}

/**
 * Serverless instances do not share SQLite, so on Vercel the limits only hold
 * with a shared Redis store. Without one, Claude stays off there.
 */
export function sharedLimitsMissing(): boolean {
  return Boolean(process.env.VERCEL) && getStore().kind !== 'redis'
}

/** The address of the connecting socket, when the server runs on Node directly. */
function socketAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? ''
  } catch {
    return ''
  }
}

/**
 * The visitor's IP address. Forwarding headers can be set by anyone, so they
 * are only read where a known proxy writes them: Vercel and Fly set their
 * own, and TRUST_PROXY=1 trusts the last x-forwarded-for hop (the one added
 * by your reverse proxy).
 */
export function visitorIp(c: Context): string {
  const first = (name: string) => c.req.header(name)?.split(',')[0]?.trim() ?? ''
  const last = (name: string) => c.req.header(name)?.split(',').at(-1)?.trim() ?? ''
  return (
    (process.env.VERCEL ? first('x-real-ip') || first('x-vercel-forwarded-for') : '') ||
    (process.env.FLY_APP_NAME ? first('fly-client-ip') : '') ||
    (process.env.TRUST_PROXY === '1' ? last('x-forwarded-for') : '') ||
    socketAddress(c) ||
    'local'
  )
}

/** A stable, non-reversible id for the visitor's IP address. */
export function visitorId(c: Context): string {
  const salt = process.env.WORDKEEP_AI_SALT ?? 'wordkeep'
  return createHash('sha256').update(`${salt}:${visitorIp(c)}`).digest('hex').slice(0, 24)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Counts one Claude analysis against the visitor's and the app's daily caps. */
export async function takeAiAllowance(visitor: string): Promise<AiAllowance> {
  const { perVisitor, total } = aiLimits()
  if (sharedLimitsMissing()) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Claude analysis needs a shared rate-limit store (Upstash Redis) on this deploy.',
      notice: { code: 'needs-redis' },
    }
  }
  try {
    const store = getStore()
    const day = today()
    const mine = await store.incr(`wk:ai:visitor:${day}:${visitor}`, DAY_TTL)
    if (mine > perVisitor) {
      return {
        ok: false,
        reason: 'visitor',
        message: `You have used today’s ${perVisitor} Claude analyses. More tomorrow.`,
        notice: { code: 'visitor-limit', params: { limit: perVisitor } },
      }
    }
    const all = await store.incr(`wk:ai:total:${day}`, DAY_TTL)
    if (all > total) {
      return {
        ok: false,
        reason: 'total',
        message: 'Wordkeep’s Claude budget for today is used up. More tomorrow.',
        notice: { code: 'total-limit' },
      }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'The rate-limit store is unreachable.',
      notice: { code: 'store-unreachable' },
    }
  }
}

const CACHE_TTL = 30 * 24 * 60 * 60

function cacheKey(parts: string[]): string {
  return `wk:phrase:${createHash('sha256').update(parts.join('\u0000')).digest('hex')}`
}

/** Shared cache of Claude analyses so a phrase is paid for once, on any instance. */
export async function readSharedAnalysis<T>(parts: string[]): Promise<T | null> {
  try {
    const raw = await getStore().get(cacheKey(parts))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export async function writeSharedAnalysis(parts: string[], value: unknown): Promise<void> {
  try {
    await getStore().set(cacheKey(parts), JSON.stringify(value), CACHE_TTL)
  } catch {
    /* caching is best effort */
  }
}

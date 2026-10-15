import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { visitorId } from './ai-limits.ts'
import { legacyExport, markLegacyHandedOver } from './legacy.ts'
import { getLanguages } from './languages.ts'
import { lookupWord } from './lookup.ts'
import { PhraseInputError, analyzePhrase } from './phrase.ts'
import { isLangCode, MAX_QUERY_CHARS } from './params.ts'
import { buildRound } from './play.ts'
import { suggestWords } from './suggest.ts'
import { handleSync } from './sync.ts'

export const app = new Hono()
app.use(secureHeaders())

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return corsOrigins[0] ?? ''
      if (corsOrigins.includes(origin)) return origin
      if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin
      return corsOrigins[0] ?? ''
    },
    credentials: true,
  }),
)

// Sync carries whole records; nothing else needs more than a small JSON body.
const smallBody = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: 'Request body too large', code: 'body-too-large' }, 413),
})
const syncBody = bodyLimit({
  maxSize: 8 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Too much at once', code: 'sync-too-large' }, 413),
})
app.use('/api/*', (c, next) => (c.req.path === '/api/sync' ? syncBody(c, next) : smallBody(c, next)))

const accessKey = process.env.WORDKEEP_ACCESS_KEY?.trim() ?? ''
// The cookie holds a token derived from the key, never the key itself.
const sessionToken = accessKey ? createHmac('sha256', accessKey).update('wordkeep-session-v1').digest('hex') : ''

function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false
  const a = createHmac('sha256', 'wordkeep-compare').update(given).digest()
  const b = createHmac('sha256', 'wordkeep-compare').update(expected).digest()
  return timingSafeEqual(a, b)
}

function isPublicPath(path: string): boolean {
  return path === '/api/health' || path === '/api/login' || path === '/api/session'
}

function isSignedIn(c: Context): boolean {
  if (!accessKey) return true
  const header = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  return sameSecret(getCookie(c, 'wordkeep_session'), sessionToken) || sameSecret(header, accessKey)
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
}

/** Ten wrong keys per visitor per quarter hour, then a pause. */
const LOGIN_WINDOW = 15 * 60 * 1000
const LOGIN_TRIES = 10
const loginTries = new Map<string, { count: number; resetAt: number }>()

function loginBlocked(visitor: string, now = Date.now()): boolean {
  const entry = loginTries.get(visitor)
  return Boolean(entry && entry.resetAt > now && entry.count >= LOGIN_TRIES)
}

function countFailedLogin(visitor: string, now = Date.now()) {
  const entry = loginTries.get(visitor)
  if (!entry || entry.resetAt <= now) {
    if (loginTries.size > 5000) loginTries.clear()
    loginTries.set(visitor, { count: 1, resetAt: now + LOGIN_WINDOW })
  } else {
    entry.count += 1
  }
}

/** A language code from the query string, or null when it is not a plain code. */
function langParam(c: Context, name: string, fallback: string): string | null {
  const value = c.req.query(name)?.trim() || fallback
  if (!value) return ''
  return isLangCode(value) ? value.toLowerCase() : null
}

function badLang(c: Context) {
  return c.json({ error: 'Unsupported language code', code: 'bad-lang' }, 400)
}

function upstreamFailed(c: Context, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  return c.json({ error: message, code: 'upstream-failed' }, 502)
}

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (isPublicPath(path) || isSignedIn(c)) return next()
  return c.json({ error: 'Unauthorized' }, 401)
})

app.get('/api/health', (c) => c.json({ ok: true, version: '2.1.0' }))

app.get('/api/session', (c) =>
  c.json({ ok: true, locked: Boolean(accessKey), signedIn: isSignedIn(c) }),
)

app.post('/api/login', async (c) => {
  if (!accessKey) return c.json({ ok: true })
  const visitor = visitorId(c)
  if (loginBlocked(visitor)) {
    return c.json({ error: 'Too many attempts. Try again later.', code: 'too-many-attempts' }, 429)
  }
  const body = (await c.req.json().catch(() => ({}))) as { key?: unknown }
  if (typeof body.key !== 'string' || !sameSecret(body.key.trim(), accessKey)) {
    countFailedLogin(visitor)
    return c.json({ error: 'Wrong key', code: 'wrong-key' }, 401)
  }
  loginTries.delete(visitor)
  setCookie(c, 'wordkeep_session', sessionToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: isHttps(c),
    maxAge: 60 * 60 * 24 * 30,
  })
  return c.json({ ok: true })
})

app.post('/api/logout', (c) => {
  deleteCookie(c, 'wordkeep_session', { path: '/' })
  deleteCookie(c, 'wordkeep_key', { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/languages', async (c) => c.json(await getLanguages()))

app.get('/api/suggest', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q || q.length > MAX_QUERY_CHARS) return c.json({ query: q ?? '', detected: [], suggestions: [] })
  const lang = langParam(c, 'lang', 'en')
  const ui = langParam(c, 'ui', '')
  if (lang === null || ui === null) return badLang(c)
  const preferred = [lang, ui].filter(Boolean)
  try {
    return c.json(await suggestWords(q, preferred))
  } catch (error) {
    return upstreamFailed(c, error, 'Suggest failed')
  }
})

app.get('/api/lookup', async (c) => {
  const q = c.req.query('q')?.trim()
  const lang = langParam(c, 'lang', 'en')
  if (!q) return c.json({ error: 'Missing q' }, 400)
  if (lang === null) return badLang(c)
  if (q.length > MAX_QUERY_CHARS) {
    return c.json({ error: 'Query too long', code: 'query-too-long', params: { max: MAX_QUERY_CHARS } }, 400)
  }
  try {
    const result = await lookupWord(q, lang)
    if (!result) return c.json({ error: 'No definitions found', code: 'not-found', q, lang }, 404)
    return c.json(result)
  } catch (error) {
    return upstreamFailed(c, error, 'Lookup failed')
  }
})

function phraseError(c: Context, error: unknown) {
  if (error instanceof PhraseInputError) {
    return c.json({ error: error.message, code: error.code, params: error.params }, 400)
  }
  return upstreamFailed(c, error, 'Phrase analysis failed')
}

app.get('/api/phrase/analyze', async (c) => {
  const q = c.req.query('q')?.trim()
  const lang = langParam(c, 'lang', 'en')
  const explain = langParam(c, 'explain', 'en')
  if (!q) return c.json({ error: 'Missing q' }, 400)
  if (lang === null || explain === null) return badLang(c)
  try {
    return c.json(await analyzePhrase(q, lang, explain, { visitor: visitorId(c) }))
  } catch (error) {
    return phraseError(c, error)
  }
})

app.get('/api/play/round', async (c) => {
  const lang = langParam(c, 'lang', 'en')
  if (lang === null) return badLang(c)
  try {
    const round = await buildRound(lang)
    if (!round) {
      return c.json(
        {
          error: `No 2,000-word discovery bank for “${lang}” yet. Try English or another major language.`,
          code: 'no-bank',
        },
        404,
      )
    }
    return c.json(round)
  } catch (error) {
    return upstreamFailed(c, error, 'Could not build a round')
  }
})

/**
 * Hand-over of a lexicon the server kept before storage moved to the device.
 * The device confirms once the words are saved, and later devices get them
 * through sync instead.
 */
app.get('/api/legacy/export', (c) => c.json(legacyExport() ?? { version: 1, words: [], senses: [], links: [] }))
app.post('/api/legacy/ack', (c) => {
  markLegacyHandedOver()
  return c.json({ ok: true })
})

app.post('/api/sync', (c) => handleSync(c))

import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { visitorId } from './ai-limits.ts'
import { legacyExport } from './legacy.ts'
import { getLanguages } from './languages.ts'
import { lookupWord } from './lookup.ts'
import { PhraseInputError, analyzePhrase } from './phrase.ts'
import { buildRound, getBank } from './play.ts'
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

const accessKey = process.env.WORDKEEP_ACCESS_KEY?.trim() ?? ''

function isPublicPath(path: string): boolean {
  return path === '/api/health' || path === '/api/login' || path === '/api/session'
}

function isSignedIn(c: Context): boolean {
  if (!accessKey) return true
  const cookie = getCookie(c, 'wordkeep_key')
  const header = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  return cookie === accessKey || header === accessKey
}

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (isPublicPath(path) || isSignedIn(c)) return next()
  return c.json({ error: 'Unauthorized' }, 401)
})

app.get('/api/health', (c) => c.json({ ok: true, version: '2.0.0' }))

app.get('/api/session', (c) =>
  c.json({ ok: true, locked: Boolean(accessKey), signedIn: isSignedIn(c) }),
)

app.post('/api/login', async (c) => {
  if (!accessKey) return c.json({ ok: true })
  const body = (await c.req.json().catch(() => ({}))) as { key?: string }
  if (body.key !== accessKey) return c.json({ error: 'Wrong key' }, 401)
  setCookie(c, 'wordkeep_key', accessKey, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
  return c.json({ ok: true })
})

app.post('/api/logout', (c) => {
  deleteCookie(c, 'wordkeep_key', { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/languages', async (c) => c.json(await getLanguages()))

app.get('/api/suggest', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json({ query: '', detected: [], suggestions: [] })
  const lang = c.req.query('lang')?.trim() || 'en'
  const ui = c.req.query('ui')?.trim() || ''
  const preferred = [lang, ui].filter(Boolean)
  try {
    return c.json(await suggestWords(q, preferred))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suggest failed'
    return c.json({ error: message }, 502)
  }
})

app.get('/api/lookup', async (c) => {
  const q = c.req.query('q')?.trim()
  const lang = c.req.query('lang')?.trim() || 'en'
  if (!q) return c.json({ error: 'Missing q' }, 400)
  try {
    const result = await lookupWord(q, lang)
    if (!result) return c.json({ error: 'No definitions found', q, lang }, 404)
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lookup failed'
    return c.json({ error: message }, 502)
  }
})

function phraseError(c: Context, error: unknown) {
  if (error instanceof PhraseInputError) {
    return c.json({ error: error.message, code: error.code, params: error.params }, 400)
  }
  const message = error instanceof Error ? error.message : 'Phrase analysis failed'
  return c.json({ error: message }, 502)
}

app.get('/api/phrase/analyze', async (c) => {
  const q = c.req.query('q')?.trim()
  const lang = c.req.query('lang')?.trim() || 'en'
  const explain = c.req.query('explain')?.trim() || 'en'
  if (!q) return c.json({ error: 'Missing q' }, 400)
  try {
    return c.json(await analyzePhrase(q, lang, explain, { visitor: visitorId(c) }))
  } catch (error) {
    return phraseError(c, error)
  }
})

app.get('/api/play/bank', async (c) => {
  const lang = c.req.query('lang')?.trim() || 'en'
  const bank = await getBank(lang)
  return c.json({ lang, languageName: bank.length ? lang : lang, bankSize: bank.length })
})

app.get('/api/play/round', async (c) => {
  const lang = c.req.query('lang')?.trim() || 'en'
  try {
    const round = await buildRound(lang)
    if (!round) {
      return c.json(
        {
          error: `No 2,000-word discovery bank for “${lang}” yet. Try English or another major language.`,
        },
        404,
      )
    }
    return c.json(round)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not build a round'
    return c.json({ error: message }, 502)
  }
})

/** One-time hand-over of a lexicon the server kept before storage moved to the device. */
app.get('/api/legacy/export', (c) => c.json(legacyExport() ?? { version: 1, words: [], senses: [], links: [] }))

app.post('/api/sync', (c) => handleSync(c))

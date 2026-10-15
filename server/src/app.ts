import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import type { Grade, KeepPhraseInput, KeepWordInput } from '../../shared/types.ts'
import { visitorId } from './ai-limits.ts'
import { exportLexicon, importLexicon } from './backup.ts'
import { wordGraph } from './graph.ts'
import { getLanguages } from './languages.ts'
import { lookupWord } from './lookup.ts'
import { PhraseInputError, analyzePhrase, phraseGloss } from './phrase.ts'
import { buildRound, getBank } from './play.ts'
import { suggestWords } from './suggest.ts'
import {
  deleteWord,
  findWordId,
  getWord,
  gradeWord,
  insertFromLookup,
  insertPhrase,
  listWords,
  recentWords,
  reviewQueue,
  stats,
  updatePhraseAnalysis,
  updateWord,
  wordKind,
} from './words.ts'

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

const GRADES: Grade[] = ['again', 'hard', 'good', 'easy']

app.get('/api/health', (c) => c.json({ ok: true, version: '1.2.0' }))

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
  if (error instanceof PhraseInputError) return c.json({ error: error.message }, 400)
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

app.post('/api/phrases', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<KeepPhraseInput>
  const text = body.text?.trim()
  const lang = body.lang?.trim()
  if (!text || !lang) return c.json({ error: 'text and lang are required' }, 400)
  try {
    const analysis = await analyzePhrase(text, lang, body.explain?.trim() || 'en', {
      visitor: visitorId(c),
    })
    if (analysis.existing) {
      return c.json({ alreadyKept: true, word: getWord(analysis.existing.id) })
    }
    const word = insertPhrase(analysis, phraseGloss(analysis), body.note ?? '')
    return c.json({ alreadyKept: false, word }, 201)
  } catch (error) {
    return phraseError(c, error)
  }
})

app.post('/api/words/:id/reanalyze', async (c) => {
  const id = c.req.param('id')
  const kind = wordKind(id)
  if (!kind) return c.json({ error: 'Not found' }, 404)
  if (kind !== 'phrase') return c.json({ error: 'Only phrases can be re-analyzed' }, 400)
  const current = getWord(id)!
  const body = (await c.req.json().catch(() => ({}))) as { explain?: string }
  try {
    const analysis = await analyzePhrase(current.displayLemma, current.language, body.explain?.trim() || 'en', {
      visitor: visitorId(c),
    })
    return c.json(updatePhraseAnalysis(id, analysis, phraseGloss(analysis)))
  } catch (error) {
    return phraseError(c, error)
  }
})

app.get('/api/stats', (c) => c.json(stats()))

app.get('/api/words', (c) => {
  const q = c.req.query('q') ?? undefined
  const status = c.req.query('status') ?? undefined
  const due = c.req.query('due') ?? undefined
  const language = c.req.query('language') ?? undefined
  const kind = c.req.query('kind') ?? undefined
  const archived = status === 'archived'
  return c.json(listWords({ q, status, due, language, kind, archived }))
})

app.get('/api/words/recent', (c) => c.json(recentWords()))

app.get('/api/words/:id', (c) => {
  const word = getWord(c.req.param('id'))
  if (!word) return c.json({ error: 'Not found' }, 404)
  return c.json(word)
})

app.post('/api/words', async (c) => {
  const body = (await c.req.json()) as KeepWordInput
  const q = body.q?.trim()
  const lang = body.lang?.trim()
  if (!q || !lang) return c.json({ error: 'q and lang are required' }, 400)

  const lookup = await lookupWord(q, lang)
  if (!lookup) return c.json({ error: 'No definitions found' }, 404)

  const existingId = lookup.existing?.id ?? findWordId(lookup.displayLemma, lookup.language)
  if (existingId) {
    const existing = getWord(existingId)
    return c.json({ alreadyKept: true, word: existing })
  }

  const word = insertFromLookup(lookup, body.note ?? '', body.primarySenseIndex ?? 0)
  return c.json({ alreadyKept: false, word }, 201)
})

app.patch('/api/words/:id', async (c) => {
  const body = (await c.req.json()) as {
    note?: string
    primarySenseId?: string
    etymology?: string
    archived?: boolean
  }
  const word = updateWord(c.req.param('id'), body)
  if (!word) return c.json({ error: 'Not found' }, 404)
  return c.json(word)
})

app.delete('/api/words/:id', (c) => {
  const ok = deleteWord(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

app.get('/api/review/queue', (c) => c.json(reviewQueue()))

app.post('/api/review/:id/grade', async (c) => {
  const body = (await c.req.json()) as { grade?: Grade }
  if (!body.grade || !GRADES.includes(body.grade)) {
    return c.json({ error: 'grade must be again | hard | good | easy' }, 400)
  }
  const word = gradeWord(c.req.param('id'), body.grade)
  if (!word) return c.json({ error: 'Not found' }, 404)
  return c.json(word)
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

app.get('/api/graph', (c) => {
  const wordId = c.req.query('wordId') ?? undefined
  return c.json(wordGraph(wordId))
})

app.get('/api/export', (c) => {
  const backup = exportLexicon()
  c.header('Content-Disposition', `attachment; filename="wordkeep-backup.json"`)
  return c.json(backup)
})

app.post('/api/import', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { mode?: string; backup?: unknown }
    | LexiconBackupShape
    | null
  if (!body) return c.json({ error: 'Invalid JSON' }, 400)
  const mode = 'mode' in body && body.mode === 'replace' ? 'replace' : 'merge'
  const payload = body && 'backup' in body && body.backup ? body.backup : body
  try {
    return c.json(importLexicon(payload, mode))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed'
    return c.json({ error: message }, 400)
  }
})

type LexiconBackupShape = { version?: number; words?: unknown; senses?: unknown; links?: unknown }

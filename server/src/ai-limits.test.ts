import './test/db-env.ts'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { Hono } from 'hono'
import { takeAiAllowance, visitorId } from './ai-limits.ts'
import { app } from './app.ts'
import { db } from './db.ts'
import { setGrammarAnalyzer, type ClaudeGrammar } from './grammar-ai.ts'
import { getStore } from './kv.ts'
import { analyzePhrase, clearPhraseCache } from './phrase.ts'
import { PHRASE_WORDS, installPhraseDictionaryMock, jsonResponse } from './test/fixtures.ts'

const GRAMMAR: ClaudeGrammar = {
  translation: 'El gato.',
  summary: '',
  sentenceType: 'fragment',
  tense: '',
  mood: '',
  voice: '',
  tokens: [],
  clauses: [],
  idioms: [],
  questions: [],
  clozeIndexes: [],
}

const saved = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key]
  }
  Object.assign(process.env, saved)
}

describe('Claude rate limits', () => {
  let calls = 0
  let dictionary: ReturnType<typeof installPhraseDictionaryMock>

  beforeEach(() => {
    db.exec('DELETE FROM kv')
    calls = 0
    setGrammarAnalyzer(async () => {
      calls += 1
      return GRAMMAR
    })
    dictionary = installPhraseDictionaryMock(PHRASE_WORDS)
  })

  afterEach(() => {
    dictionary.restore()
    setGrammarAnalyzer(null)
    clearPhraseCache()
    restoreEnv()
  })

  it('caps each visitor per day and falls back to the dictionary', async () => {
    process.env.WORDKEEP_AI_DAILY_PER_VISITOR = '2'
    const first = await analyzePhrase('the cat', 'en', 'es', { visitor: 'a' })
    const second = await analyzePhrase('the bucket', 'en', 'es', { visitor: 'a' })
    const third = await analyzePhrase('kick the cat', 'en', 'es', { visitor: 'a' })
    assert.equal(first.source, 'claude')
    assert.equal(second.source, 'claude')
    assert.equal(third.source, 'dictionary')
    assert.match(third.note ?? '', /today’s 2 Claude analyses/)
    assert.deepEqual(third.notice, { code: 'visitor-limit', params: { limit: 2 } })
    assert.equal(calls, 2)

    const other = await analyzePhrase('kick the cat', 'en', 'es', { visitor: 'b' })
    assert.equal(other.source, 'claude')
  })

  it('caps the whole app per day', async () => {
    process.env.WORDKEEP_AI_DAILY_TOTAL = '1'
    assert.equal((await analyzePhrase('the cat', 'en', 'es', { visitor: 'a' })).source, 'claude')
    const blocked = await analyzePhrase('the bucket', 'en', 'es', { visitor: 'b' })
    assert.equal(blocked.source, 'dictionary')
    assert.match(blocked.note ?? '', /budget for today is used up/)
    assert.deepEqual(blocked.notice, { code: 'total-limit' })
  })

  it('serves repeat phrases from the shared cache without spending allowance', async () => {
    process.env.WORDKEEP_AI_DAILY_PER_VISITOR = '1'
    await analyzePhrase('the cat', 'en', 'es', { visitor: 'a' })
    clearPhraseCache()
    const again = await analyzePhrase('the cat', 'en', 'es', { visitor: 'a' })
    assert.equal(again.source, 'claude')
    assert.equal(again.translation, 'El gato.')
    assert.equal(calls, 1)
  })

  it('does not count blocked attempts against the app-wide cap', async () => {
    process.env.WORDKEEP_AI_DAILY_PER_VISITOR = '0'
    process.env.WORDKEEP_AI_DAILY_TOTAL = '1'
    assert.equal((await takeAiAllowance('spammer')).ok, false)
    assert.equal((await takeAiAllowance('spammer')).ok, false)
    process.env.WORDKEEP_AI_DAILY_PER_VISITOR = '5'
    assert.equal((await takeAiAllowance('someone')).ok, true)
  })

  it('keeps Claude off on Vercel without a shared store', async () => {
    process.env.VERCEL = '1'
    const result = await analyzePhrase('the cat', 'en', 'es', { visitor: 'a' })
    assert.equal(result.source, 'dictionary')
    assert.match(result.note ?? '', /Upstash Redis/)
    assert.deepEqual(result.notice, { code: 'needs-redis' })
    assert.equal(calls, 0)
  })

  it('uses Upstash Redis over REST when configured', async () => {
    const original = globalThis.fetch
    const counts = new Map<string, number>()
    const sent: unknown[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('https://redis.test')) return original(input, init)
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret')
      const commands = JSON.parse(String(init?.body)) as string[][]
      sent.push(...commands)
      return jsonResponse(
        commands.map(([name, key]) => {
          if (name === 'INCR') {
            counts.set(key!, (counts.get(key!) ?? 0) + 1)
            return { result: counts.get(key!) }
          }
          return { result: name === 'GET' ? null : 'OK' }
        }),
      )
    }) as typeof fetch
    try {
      process.env.KV_REST_API_URL = 'https://redis.test/'
      process.env.KV_REST_API_TOKEN = 'secret'
      process.env.VERCEL = '1'
      assert.equal(getStore().kind, 'redis')
      const result = await analyzePhrase('the cat', 'en', 'es', { visitor: 'a' })
      assert.equal(result.source, 'claude')
      assert.ok(sent.some((command) => (command as string[])[0] === 'EXPIRE'))
      assert.ok(sent.some((command) => (command as string[])[0] === 'SET'))
    } finally {
      globalThis.fetch = original
    }
  })

  it('treats an unreachable store as no allowance', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.down'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'secret'
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://redis.down')) throw new Error('down')
      return original(input, init)
    }) as typeof fetch
    try {
      const result = await analyzePhrase('the cat', 'en', 'es', { visitor: 'a' })
      assert.equal(result.source, 'dictionary')
      assert.equal(calls, 0)
    } finally {
      globalThis.fetch = original
    }
  })

  it('identifies visitors by IP without storing it', async () => {
    const probe = new Hono().get('/', (c) => c.text(visitorId(c)))
    const id = async (headers: Record<string, string>) => (await probe.request('/', { headers })).text()
    const a = await id({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })
    assert.equal(a, await id({ 'x-forwarded-for': '1.2.3.4' }))
    assert.notEqual(a, await id({ 'x-forwarded-for': '5.6.7.8' }))
    assert.ok(!a.includes('1.2.3.4'))
    assert.equal(await id({ 'x-real-ip': '9.9.9.9' }), await id({}))
    process.env.VERCEL = '1'
    assert.notEqual(await id({ 'x-real-ip': '9.9.9.9' }), await id({}))
  })

  it('the API passes each caller’s identity to the limiter', async () => {
    process.env.WORDKEEP_AI_DAILY_PER_VISITOR = '1'
    const ask = (q: string, ip: string) =>
      app.request(`/api/phrase/analyze?q=${encodeURIComponent(q)}&lang=en&explain=es`, {
        headers: { 'x-forwarded-for': ip },
      })
    assert.equal(((await (await ask('the cat', '1.1.1.1')).json()) as { source: string }).source, 'claude')
    assert.equal(((await (await ask('the bucket', '1.1.1.1')).json()) as { source: string }).source, 'dictionary')
    assert.equal(((await (await ask('the bucket', '2.2.2.2')).json()) as { source: string }).source, 'claude')
  })
})

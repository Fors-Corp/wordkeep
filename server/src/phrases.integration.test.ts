import './test/db-env.ts'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { WordDetail, WordSummary } from '../../shared/types.ts'
import { app } from './app.ts'
import { exportLexicon, importLexicon } from './backup.ts'
import { db } from './db.ts'
import { setGrammarAnalyzer } from './grammar-ai.ts'
import { clearLookupCache } from './lookup.ts'
import { clearPhraseCache } from './phrase.ts'
import { DEMO_PHRASE } from './seed-graph.ts'
import { PHRASE_WORDS, installPhraseDictionaryMock, lookupFixture } from './test/fixtures.ts'
import { getWord, insertFromLookup, insertPhrase, listWords } from './words.ts'

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function wipe() {
  db.exec('DELETE FROM word_links')
  db.exec('DELETE FROM senses')
  db.exec('DELETE FROM words')
}

describe('phrase API', () => {
  let mock: ReturnType<typeof installPhraseDictionaryMock>

  beforeEach(() => {
    wipe()
    mock = installPhraseDictionaryMock(PHRASE_WORDS)
  })

  afterEach(() => {
    mock.restore()
    clearPhraseCache()
    clearLookupCache()
    setGrammarAnalyzer(null)
  })

  it('GET /api/phrase/analyze validates input and returns a breakdown', async () => {
    assert.equal((await app.request('/api/phrase/analyze')).status, 400)
    assert.equal((await app.request('/api/phrase/analyze?q=...')).status, 400)

    const res = await app.request('/api/phrase/analyze?q=The%20cat%20sat.&lang=en')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { tokens: Array<{ text: string; lemma: string }>; existing: unknown }
    assert.deepEqual(
      body.tokens.map((token) => token.lemma),
      ['the', 'cat', 'sit', '.'],
    )
    assert.equal(body.existing, null)
  })

  it('keeps a phrase, lists it by kind, reviews it, and re-analyzes it', async () => {
    const created = await post('/api/phrases', { text: 'The cat sat.', lang: 'en', note: 'hook' })
    assert.equal(created.status, 201)
    const { word } = (await created.json()) as { word: WordDetail }
    assert.equal(word.kind, 'phrase')
    assert.equal(word.displayLemma, 'The cat sat.')
    assert.equal(word.note, 'hook')
    assert.equal(word.analysis?.tokens.length, 4)
    assert.equal(word.analysis?.existing?.id, word.id)
    assert.equal(word.senses[0]?.partOfSpeech, 'phrase')
    assert.ok(word.gloss.includes('cat'))
    assert.deepEqual(
      word.links.map((link) => [link.lemma, link.relation]).sort(),
      [
        ['cat', 'phrase'],
        ['sit', 'phrase'],
      ],
    )

    const again = await post('/api/phrases', { text: 'the cat   sat.', lang: 'en' })
    assert.equal(again.status, 200)
    assert.equal(((await again.json()) as { alreadyKept: boolean }).alreadyKept, true)

    const analyzed = await app.request('/api/phrase/analyze?q=The%20cat%20sat.&lang=en')
    assert.deepEqual(((await analyzed.json()) as { existing: unknown }).existing, { id: word.id })

    insertFromLookup(lookupFixture({ lemma: 'happy', displayLemma: 'happy' }), '', 0)
    const phrases = (await (await app.request('/api/words?kind=phrase')).json()) as WordSummary[]
    assert.deepEqual(phrases.map((item) => item.displayLemma), ['The cat sat.'])
    const words = (await (await app.request('/api/words?kind=word')).json()) as WordSummary[]
    assert.deepEqual(words.map((item) => item.displayLemma), ['happy'])

    const stats = (await (await app.request('/api/stats')).json()) as { phraseCount: number }
    assert.equal(stats.phraseCount, 1)

    const queue = (await (await app.request('/api/review/queue')).json()) as WordDetail[]
    assert.ok(queue.some((item) => item.id === word.id && item.analysis))
    const graded = await post(`/api/review/${word.id}/grade`, { grade: 'good' })
    assert.equal(graded.status, 200)

    setGrammarAnalyzer(async () => ({
      translation: 'Le chat s’est assis.',
      summary: 'Subject and verb.',
      sentenceType: 'declarative',
      tense: 'simple past',
      mood: 'indicative',
      voice: 'active',
      tokens: [],
      clauses: [],
      idioms: [],
      questions: [{ question: 'Tense?', answer: 'Past' }],
      clozeIndexes: [2],
    }))
    const redone = await post(`/api/words/${word.id}/reanalyze`, { explain: 'fr' })
    assert.equal(redone.status, 200)
    const updated = (await redone.json()) as WordDetail
    assert.equal(updated.analysis?.source, 'claude')
    assert.equal(updated.gloss, 'Le chat s’est assis.')
    assert.deepEqual(updated.senses[0]?.tags, ['declarative', 'simple past', 'indicative', 'active'])
  })

  it('links phrases to words kept before and after them', async () => {
    const cat = insertFromLookup(lookupFixture({ lemma: 'cat', displayLemma: 'cat', translations: [] }), '', 0)
    const created = await post('/api/phrases', { text: 'The cat sat.', lang: 'en' })
    const { word: phrase } = (await created.json()) as { word: WordDetail }
    assert.equal(phrase.links.find((link) => link.lemma === 'cat')?.toWordId, cat.id)
    assert.ok(getWord(cat.id)!.links.some((link) => link.relation === 'phrase' && link.toWordId === phrase.id))

    const sit = insertFromLookup(lookupFixture({ lemma: 'sit', displayLemma: 'sit', translations: [] }), '', 0)
    assert.equal(getWord(phrase.id)!.links.find((link) => link.lemma === 'sit')?.toWordId, sit.id)
    assert.ok(getWord(sit.id)!.links.some((link) => link.relation === 'phrase' && link.toWordId === phrase.id))

    const atlas = (await (await app.request('/api/graph')).json()) as {
      nodes: Array<{ id: string; kind: string }>
      edges: Array<{ source: string; target: string; relation: string }>
    }
    assert.equal(atlas.nodes.find((node) => node.id === `word:${phrase.id}`)?.kind, 'phrase')
    assert.ok(atlas.edges.some((edge) => edge.relation === 'phrase'))

    const centered = (await (await app.request(`/api/graph?wordId=${cat.id}`)).json()) as {
      nodes: Array<{ id: string; kind: string }>
    }
    assert.equal(centered.nodes.find((node) => node.id === `word:${phrase.id}`)?.kind, 'phrase')
  })

  it('shows a phrase’s unkept words in the whole-lexicon atlas', async () => {
    const created = await post('/api/phrases', { text: 'The cat sat.', lang: 'en' })
    const { word: phrase } = (await created.json()) as { word: WordDetail }
    const atlas = (await (await app.request('/api/graph')).json()) as {
      nodes: Array<{ id: string; kind: string; label: string; wordId: string | null }>
      edges: Array<{ source: string; target: string; relation: string }>
    }
    const ghosts = atlas.nodes.filter((node) => node.kind === 'word')
    assert.deepEqual(ghosts.map((node) => node.label).sort(), ['cat', 'sit'])
    assert.ok(ghosts.every((node) => node.wordId === null))
    for (const ghost of ghosts) {
      assert.ok(
        atlas.edges.some(
          (edge) => edge.source === `word:${phrase.id}` && edge.target === ghost.id && edge.relation === 'phrase',
        ),
      )
    }
    assert.ok(!atlas.nodes.some((node) => node.label === 'the'))

    const cat = insertFromLookup(lookupFixture({ lemma: 'cat', displayLemma: 'cat', translations: [] }), '', 0)
    const after = (await (await app.request('/api/graph')).json()) as { nodes: Array<{ id: string; kind: string }> }
    assert.ok(after.nodes.some((node) => node.id === `word:${cat.id}`))
    assert.ok(!after.nodes.some((node) => node.id === 'ghost:en:cat'))
  })

  it('reanalyze rejects words and unknown ids', async () => {
    const happy = insertFromLookup(lookupFixture(), '', 0)
    assert.equal((await post(`/api/words/${happy.id}/reanalyze`, {})).status, 400)
    assert.equal((await post('/api/words/nope/reanalyze', {})).status, 404)
    assert.equal((await post('/api/phrases', {})).status, 400)
  })

  it('round-trips phrases through backup, and old backups import as words', () => {
    insertPhrase(DEMO_PHRASE, DEMO_PHRASE.translation, 'demo')
    const dump = exportLexicon()
    wipe()
    importLexicon(dump, 'replace')
    const [restored] = listWords({ kind: 'phrase' })
    assert.equal(restored?.displayLemma, 'I am very happy.')
    assert.equal(getWord(restored!.id)?.analysis?.tense, 'present simple')

    const legacy = {
      ...dump,
      words: dump.words.map(({ kind: _kind, analysis_json: _analysis, ...row }) => ({
        ...row,
        id: 'legacy',
        lemma: 'legacy',
      })),
      senses: [],
      links: [],
    }
    importLexicon(legacy, 'merge')
    assert.equal(getWord('legacy')?.kind, 'word')
    assert.equal(getWord('legacy')?.analysis, null)
  })
})

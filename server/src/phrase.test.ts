import './test/db-env.ts'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { setGrammarAnalyzer, type GrammarRequest } from './grammar-ai.ts'
import { PhraseInputError, analyzePhrase, clearPhraseCache, parseFormOf, phraseGloss } from './phrase.ts'
import { PHRASE_WORDS, installPhraseDictionaryMock } from './test/fixtures.ts'

describe('phrase analysis', () => {
  afterEach(() => {
    clearPhraseCache()
    setGrammarAnalyzer(null)
  })

  it('reads form-of definitions', () => {
    assert.deepEqual(parseFormOf('simple past and past participle of sit'), {
      features: 'simple past and past participle',
      lemma: 'sit',
    })
    assert.deepEqual(parseFormOf('first-person singular present indicative of hablar'), {
      features: 'first-person singular present indicative',
      lemma: 'hablar',
    })
    assert.deepEqual(parseFormOf('plural of “cat”'), { features: 'plural', lemma: 'cat' })
    assert.equal(parseFormOf('A small domesticated carnivorous mammal.'), null)
    assert.equal(parseFormOf('Out of breath'), null)
  })

  it('builds a dictionary breakdown without Claude', async () => {
    const mock = installPhraseDictionaryMock(PHRASE_WORDS)
    try {
      const result = await analyzePhrase('The  cat sat.', 'en')
      assert.equal(result.text, 'The cat sat.')
      assert.equal(result.source, 'dictionary')
      assert.match(result.note ?? '', /ANTHROPIC_API_KEY/)
      assert.deepEqual(
        result.tokens.map((token) => [token.text, token.partOfSpeech, token.lemma]),
        [
          ['The', 'article', 'the'],
          ['cat', 'noun', 'cat'],
          ['sat', 'verb', 'sit'],
          ['.', 'punctuation', '.'],
        ],
      )
      const sat = result.tokens[2]!
      assert.deepEqual(sat.features, ['simple past and past participle'])
      assert.match(sat.gloss, /upper body upright/)
      assert.deepEqual(result.clozeIndexes, [1, 2])
      assert.ok(result.questions.some((item) => item.question.includes('“sat”')))
      assert.equal(result.existing, null)
    } finally {
      mock.restore()
    }
  })

  it('finds idioms listed as whole dictionary entries', async () => {
    const mock = installPhraseDictionaryMock(PHRASE_WORDS)
    try {
      const result = await analyzePhrase('kick the bucket', 'en')
      assert.deepEqual(result.idioms, [{ text: 'kick the bucket', meaning: '(idiomatic) To die.' }])
      assert.equal(phraseGloss(result), '(idiomatic) To die.')
    } finally {
      mock.restore()
    }
  })

  it('caches word lookups across phrases', async () => {
    const mock = installPhraseDictionaryMock(PHRASE_WORDS)
    try {
      await analyzePhrase('the cat', 'en')
      const before = mock.calls.filter((word) => word === 'cat').length
      await analyzePhrase('the cat sat', 'en')
      assert.equal(mock.calls.filter((word) => word === 'cat').length, before)
    } finally {
      mock.restore()
    }
  })

  it('does not cache words whose lookup failed', async () => {
    const original = globalThis.fetch
    let down = true
    const mock = installPhraseDictionaryMock(PHRASE_WORDS)
    const mocked = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (down) throw new Error('offline')
      return mocked(input, init)
    }) as typeof fetch
    try {
      const offline = await analyzePhrase('the cat', 'en')
      assert.equal(offline.tokens[1]!.known, false)
      down = false
      const online = await analyzePhrase('the cat', 'en')
      assert.equal(online.tokens[1]!.partOfSpeech, 'noun')
    } finally {
      globalThis.fetch = original
      mock.restore()
    }
  })

  it('merges Claude’s analysis over the dictionary', async () => {
    const mock = installPhraseDictionaryMock(PHRASE_WORDS)
    let seen: GrammarRequest | null = null
    setGrammarAnalyzer(async (request) => {
      seen = request
      return {
        translation: 'El gato se sentó.',
        summary: 'Subject plus intransitive verb.',
        sentenceType: 'declarative',
        tense: 'simple past',
        mood: 'indicative',
        voice: 'active',
        tokens: [
          { index: 0, lemma: 'the', partOfSpeech: 'Determiner', role: 'determiner', features: [], explanation: 'Marks a known cat.' },
          { index: 1, lemma: 'cat', partOfSpeech: 'noun', role: 'subject', features: ['singular'], explanation: 'Who sat.' },
          { index: 2, lemma: 'sit', partOfSpeech: 'verb', role: 'predicate', features: ['past'], explanation: 'The action.' },
        ],
        clauses: [{ text: 'The cat sat', type: 'main', explanation: 'One clause.' }],
        idioms: [],
        questions: [{ question: 'What tense is “sat”?', answer: 'Simple past' }],
        clozeIndexes: [2, 3, 99],
      }
    })
    try {
      const result = await analyzePhrase('The cat sat.', 'en', 'es')
      assert.equal(seen!.explainIn, 'Spanish')
      assert.deepEqual(
        seen!.tokens.map((token) => token.index),
        [0, 1, 2],
      )
      assert.equal(result.source, 'claude')
      assert.equal(result.note, null)
      assert.equal(result.translation, 'El gato se sentó.')
      assert.equal(result.tokens[0]!.partOfSpeech, 'determiner')
      assert.equal(result.tokens[1]!.role, 'subject')
      assert.match(result.tokens[1]!.gloss, /mammal/)
      assert.deepEqual(result.clozeIndexes, [2])
      assert.equal(phraseGloss(result), 'El gato se sentó.')
    } finally {
      mock.restore()
    }
  })

  it('falls back to the dictionary when Claude fails', async () => {
    const mock = installPhraseDictionaryMock(PHRASE_WORDS)
    setGrammarAnalyzer(async () => {
      throw new Error('overloaded')
    })
    try {
      const result = await analyzePhrase('the cat', 'en')
      assert.equal(result.source, 'dictionary')
      assert.match(result.note ?? '', /overloaded/)
    } finally {
      mock.restore()
    }
  })

  it('rejects empty and oversized input', async () => {
    await assert.rejects(analyzePhrase('   ', 'en'), PhraseInputError)
    await assert.rejects(analyzePhrase('...', 'en'), PhraseInputError)
    await assert.rejects(analyzePhrase(Array.from({ length: 41 }, () => 'cat').join(' '), 'en'), /40 words/)
  })
})

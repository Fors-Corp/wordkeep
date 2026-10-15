import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clozePrompt, looksLikePhrase, normalizePhrase, phraseCardFor, segmentPhrase } from './phrase.ts'
import type { PhraseAnalysis, PhraseToken } from './types.ts'

function token(index: number, start: number, text: string, extra: Partial<PhraseToken> = {}): PhraseToken {
  return {
    index,
    start,
    text,
    lemma: text.toLowerCase(),
    partOfSpeech: 'noun',
    features: [],
    role: '',
    gloss: '',
    explanation: '',
    known: true,
    punct: false,
    ...extra,
  }
}

function analysis(overrides: Partial<PhraseAnalysis> = {}): PhraseAnalysis {
  return {
    text: 'The cat sat.',
    language: 'en',
    languageName: 'English',
    source: 'dictionary',
    translation: '',
    summary: '',
    sentenceType: '',
    tense: '',
    mood: '',
    voice: '',
    clauses: [],
    idioms: [],
    tokens: [
      token(0, 0, 'The', { partOfSpeech: 'article' }),
      token(1, 4, 'cat'),
      token(2, 8, 'sat', { partOfSpeech: 'verb', lemma: 'sit' }),
      token(3, 11, '.', { punct: true, partOfSpeech: 'punctuation' }),
    ],
    questions: [],
    clozeIndexes: [],
    note: null,
    existing: null,
    ...overrides,
  }
}

describe('phrase helpers', () => {
  it('segments words and punctuation without whitespace', () => {
    const parts = segmentPhrase('The cat sat.', 'en')
    assert.deepEqual(
      parts.map((part) => [part.text, part.start, part.wordLike]),
      [
        ['The', 0, true],
        ['cat', 4, true],
        ['sat', 8, true],
        ['.', 11, false],
      ],
    )
  })

  it('detects phrases and normalizes spacing', () => {
    assert.equal(looksLikePhrase('happy', 'en'), false)
    assert.equal(looksLikePhrase('  happy  ', 'en'), false)
    assert.equal(looksLikePhrase('kick the bucket', 'en'), true)
    assert.equal(looksLikePhrase('estoy feliz', 'xx-invalid-tag-!!'), true)
    assert.equal(normalizePhrase('  kick   the\nbucket '), 'kick the bucket')
  })

  it('blanks one token for cloze', () => {
    const item = analysis()
    assert.equal(clozePrompt(item.text, item.tokens[2]!), 'The cat _____.')
  })

  it('rotates meaning, cloze, and grammar cards', () => {
    const item = analysis({ questions: [{ question: 'What tense is “sat”?', answer: 'Simple past' }] })
    assert.equal(phraseCardFor(item, 0).mode, 'meaning')
    const cloze = phraseCardFor(item, 1)
    assert.equal(cloze.mode, 'cloze')
    if (cloze.mode === 'cloze') {
      assert.equal(cloze.answer, 'cat')
      assert.equal(cloze.prompt, 'The _____ sat.')
    }
    const grammar = phraseCardFor(item, 2)
    assert.deepEqual(grammar, { mode: 'grammar', question: 'What tense is “sat”?', answer: 'Simple past' })
    const nextCloze = phraseCardFor(item, 4)
    assert.equal(nextCloze.mode === 'cloze' && nextCloze.answer, 'sat')
    assert.equal(nextCloze.mode === 'cloze' && nextCloze.hint, 'sit · verb')
  })

  it('prefers the cloze indexes the analysis suggests', () => {
    const card = phraseCardFor(analysis({ clozeIndexes: [2] }), 1)
    assert.equal(card.mode === 'cloze' && card.answer, 'sat')
  })

  it('falls back to meaning recall without analysis', () => {
    assert.deepEqual(phraseCardFor(null, 3), { mode: 'meaning' })
  })
})

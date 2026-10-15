import { entryFromPhrase, type StoredEntry } from '@shared/lexicon'
import { phraseGloss } from '@shared/phrase'
import type { PhraseAnalysis, PhraseToken, WordDetail } from '@shared/types'
import { openDeviceStore } from '../lib/store'

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

export function phraseFixture(overrides: Partial<PhraseAnalysis> = {}): PhraseAnalysis {
  return {
    text: 'The cat sat.',
    language: 'en',
    languageName: 'English',
    source: 'claude',
    translation: 'El gato se sentó.',
    summary: 'Subject plus intransitive verb.',
    sentenceType: 'declarative',
    tense: 'simple past',
    mood: 'indicative',
    voice: 'active',
    clauses: [{ text: 'The cat sat', type: 'main', explanation: 'One clause.' }],
    idioms: [{ text: 'sat down', meaning: 'took a seat' }],
    tokens: [
      token(0, 0, 'The', { partOfSpeech: 'article', role: 'determiner' }),
      token(1, 4, 'cat', { role: 'subject', gloss: 'A small mammal.' }),
      token(2, 8, 'sat', {
        lemma: 'sit',
        partOfSpeech: 'verb',
        role: 'predicate',
        features: ['past'],
        explanation: 'The action.',
      }),
      token(3, 11, '.', { partOfSpeech: 'punctuation', punct: true, known: false, lemma: '.' }),
    ],
    questions: [{ question: 'What tense is “sat”?', answer: 'Simple past' }],
    clozeIndexes: [2],
    note: null,
    existing: null,
    ...overrides,
  }
}

export function phraseWord(overrides: Partial<WordDetail> = {}): WordDetail {
  const analysis = phraseFixture({ existing: { id: 'p1' } })
  return {
    id: 'p1',
    kind: 'phrase',
    lemma: 'the cat sat.',
    displayLemma: 'The cat sat.',
    language: 'en',
    languageName: 'English',
    phonetic: null,
    gloss: analysis.translation,
    status: 'new',
    dueAt: 0,
    archivedAt: null,
    lastReviewedAt: null,
    createdAt: 0,
    etymology: null,
    note: '',
    primarySenseId: 's1',
    easeFactor: 2.5,
    intervalDays: 0,
    repetitions: 0,
    updatedAt: 0,
    forms: [],
    senses: [],
    links: [],
    analysis,
    ...overrides,
  }
}

/** A kept phrase as the device stores it, due for review now. */
export function phraseEntry(overrides: Partial<StoredEntry> = {}, analysis = phraseFixture()): StoredEntry {
  const entry = entryFromPhrase(analysis, phraseGloss(analysis), { id: overrides.id ?? 'p1', now: 0 })
  return { ...entry, ...overrides }
}

/** Puts records on the (fake) device before the app opens. */
export async function seedDevice(entries: StoredEntry[]) {
  const store = await openDeviceStore()
  await store.putEntries(entries)
  await store.setMeta('legacyChecked', true)
}

export async function deviceEntries(): Promise<StoredEntry[]> {
  return (await openDeviceStore()).loadEntries()
}

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEMO_PHRASE, sampleEntries, sampleId } from './demo.ts'
import {
  Lexicon,
  entryFromLookup,
  entryFromPhrase,
  planImport,
  readBackup,
  tombstone,
  withGrade,
  withPatch,
  withPhraseAnalysis,
  type StoredEntry,
} from './lexicon.ts'
import type { LookupResult, PhraseAnalysis } from './types.ts'

function lookup(overrides: Partial<LookupResult> = {}): LookupResult {
  return {
    lemma: 'happy',
    displayLemma: 'happy',
    language: 'en',
    languageName: 'English',
    phonetic: '/ˈhæpi/',
    etymology: 'From Middle English hap.',
    fallbackFrom: null,
    forms: [{ word: 'happier', tags: ['comparative'] }],
    senses: [
      {
        partOfSpeech: 'adjective',
        definition: 'Feeling or showing pleasure or contentment.',
        examples: ['A happy child.'],
        synonyms: ['glad', 'joyful'],
        antonyms: ['sad'],
        tags: [],
      },
      {
        partOfSpeech: 'adjective',
        definition: 'Fortunate.',
        examples: [],
        synonyms: [],
        antonyms: [],
        tags: [],
      },
    ],
    translations: [
      { lemma: 'feliz', language: 'es', languageName: 'Spanish' },
      { lemma: 'heureux', language: 'fr', languageName: 'French' },
    ],
    existing: null,
    ...overrides,
  }
}

const catSat: PhraseAnalysis = {
  ...DEMO_PHRASE,
  text: 'The cat sat.',
  tokens: [
    { index: 0, start: 0, text: 'The', lemma: 'the', partOfSpeech: 'article', features: [], role: '', gloss: '', explanation: '', known: true, punct: false },
    { index: 1, start: 4, text: 'cat', lemma: 'cat', partOfSpeech: 'noun', features: [], role: '', gloss: '', explanation: '', known: true, punct: false },
    { index: 2, start: 8, text: 'sat', lemma: 'sit', partOfSpeech: 'verb', features: [], role: '', gloss: '', explanation: '', known: true, punct: false },
    { index: 3, start: 11, text: '.', lemma: '.', partOfSpeech: 'punctuation', features: [], role: '', gloss: '', explanation: '', known: false, punct: true },
  ],
}

describe('lexicon records', () => {
  it('keeps a lookup with senses, primary sense, and links', () => {
    const entry = entryFromLookup(lookup(), { note: 'hook', primarySenseIndex: 1, now: 1000, id: 'h' })
    assert.equal(entry.primarySenseId, 'h-s1')
    assert.equal(entry.status, 'new')
    assert.equal(entry.dueAt, 1000)
    const word = new Lexicon([entry]).detail('h')!
    assert.equal(word.gloss, 'Fortunate.')
    assert.equal(word.note, 'hook')
    assert.deepEqual(
      word.links.map((link) => `${link.relation}:${link.lemma}`).sort(),
      ['antonym:sad', 'synonym:glad', 'synonym:joyful', 'translation:feliz', 'translation:heureux'],
    )
  })

  it('lists, filters, archives, and deletes', () => {
    const happy = entryFromLookup(lookup(), { id: 'h', now: 1 })
    const sad = entryFromLookup(lookup({ lemma: 'sad', displayLemma: 'sad' }), { id: 's', now: 2 })
    let lexicon = new Lexicon([happy, sad])
    assert.equal(lexicon.list().length, 2)
    assert.equal(lexicon.list({ q: 'HAP' }).length, 1)
    assert.equal(lexicon.list({ language: 'en' }).length, 2)
    assert.equal(lexicon.list({ kind: 'phrase' }).length, 0)

    const archived = withPatch(happy, { archived: true, note: 'later' }, 5)
    lexicon = new Lexicon([archived, sad])
    assert.equal(lexicon.list().length, 1)
    assert.equal(lexicon.list({ archived: true })[0]?.id, 'h')
    assert.equal(lexicon.stats(10).lexiconCount, 1)

    lexicon = new Lexicon([tombstone(archived, 6), sad])
    assert.equal(lexicon.detail('h'), null)
    assert.equal(lexicon.findId('happy', 'en'), null)
  })

  it('reviews due cards with SM-2 and reports stats', () => {
    const happy = entryFromLookup(lookup(), { id: 'h', now: 1000 })
    const lexicon = new Lexicon([happy])
    assert.equal(lexicon.reviewQueue(1000).length, 1)
    assert.deepEqual(lexicon.stats(1000), { dueToday: 1, newCount: 1, lexiconCount: 1, languageCount: 1, phraseCount: 0 })
    const graded = withGrade(happy, 'good', 2000)
    assert.ok(graded.dueAt > 2000)
    assert.equal(graded.repetitions, 1)
    assert.equal(graded.updatedAt, 2000)
    assert.equal(new Lexicon([graded]).reviewQueue(2000).length, 0)
  })

  it('links words both ways when the other side is kept, whichever came first', () => {
    const happy = entryFromLookup(lookup(), { id: 'h' })
    const glad = entryFromLookup(lookup({ lemma: 'glad', displayLemma: 'glad', translations: [], senses: [] }), { id: 'g' })
    const lexicon = new Lexicon([happy, glad])
    assert.equal(lexicon.detail('h')!.links.find((link) => link.lemma === 'glad')?.toWordId, 'g')
    const back = lexicon.detail('g')!.links.find((link) => link.lemma === 'happy')
    assert.equal(back?.relation, 'synonym')
    assert.equal(back?.toWordId, 'h')
  })

  it('keeps phrases linked to their key words, in the atlas too', () => {
    const phrase = entryFromPhrase(catSat, 'A cat was sitting.', { id: 'p', note: 'n' })
    assert.equal(phrase.kind, 'phrase')
    assert.equal(phrase.senses[0]?.partOfSpeech, 'phrase')
    assert.deepEqual(
      phrase.links.map((link) => link.lemma),
      ['cat', 'sit'],
    )
    const cat = entryFromLookup(lookup({ lemma: 'cat', displayLemma: 'cat', translations: [], senses: [] }), { id: 'c' })
    const lexicon = new Lexicon([phrase, cat])
    const detail = lexicon.detail('p')!
    assert.equal(detail.analysis?.existing?.id, 'p')
    assert.equal(detail.gloss, 'A cat was sitting.')
    assert.equal(detail.links.find((link) => link.lemma === 'cat')?.toWordId, 'c')
    assert.ok(lexicon.detail('c')!.links.some((link) => link.relation === 'phrase' && link.toWordId === 'p'))

    const atlas = lexicon.graph()
    assert.equal(atlas.nodes.find((node) => node.id === 'word:p')?.kind, 'phrase')
    assert.deepEqual(
      atlas.nodes.filter((node) => node.kind === 'word').map((node) => node.label),
      ['sit'],
    )
    assert.ok(atlas.edges.some((edge) => edge.source === 'word:p' && edge.target === 'word:c'))
    assert.equal(lexicon.graph('c').nodes.find((node) => node.id === 'word:p')?.kind, 'phrase')

    const redone = withPhraseAnalysis(phrase, { ...catSat, source: 'claude', tense: 'past' }, 'Le chat.', 99)
    assert.equal(redone.analysis?.source, 'claude')
    assert.equal(new Lexicon([redone]).detail('p')!.gloss, 'Le chat.')
    assert.deepEqual(redone.senses[0]?.tags, ['declarative', 'past', 'indicative', 'active'])
  })

  it('round-trips backups and reads the old server format', () => {
    const happy = entryFromLookup(lookup(), { id: 'h', note: 'keep me' })
    const backup = new Lexicon([happy]).backup()
    const restored = readBackup(JSON.parse(JSON.stringify(backup)))
    assert.equal(restored[0]?.note, 'keep me')

    const v1 = {
      version: 1,
      words: [
        { id: 'w1', lemma: 'feliz', display_lemma: 'feliz', language: 'es', language_name: 'Spanish', note: '', status: 'review', due_at: 5, created_at: 1, updated_at: 2, forms_json: '[]', primary_sense_id: 's1' },
        { id: 'p1', kind: 'phrase', lemma: 'the cat sat.', display_lemma: 'The cat sat.', language: 'en', analysis_json: JSON.stringify(catSat) },
      ],
      senses: [{ id: 's1', word_id: 'w1', part_of_speech: 'adjective', definition: 'Contento.', synonyms_json: '["alegre"]', sort_order: 0 }],
      links: [{ id: 'l1', from_word_id: 'w1', to_lemma: 'happy', to_language: 'en', to_language_name: 'English', relation: 'translation' }],
    }
    const old = readBackup(v1)
    const lexicon = new Lexicon(old)
    const feliz = lexicon.detail('w1')!
    assert.equal(feliz.gloss, 'Contento.')
    assert.equal(feliz.status, 'review')
    assert.deepEqual(feliz.senses[0]?.synonyms, ['alegre'])
    assert.equal(feliz.links[0]?.lemma, 'happy')
    assert.equal(lexicon.detail('p1')?.kind, 'phrase')
    assert.equal(lexicon.detail('p1')?.analysis?.tokens.length, 4)

    assert.throws(() => readBackup({ version: 3 }), /Invalid backup/)
  })

  it('plans merge and replace imports', () => {
    const happy = entryFromLookup(lookup(), { id: 'h' })
    const sad = entryFromLookup(lookup({ lemma: 'sad', displayLemma: 'sad' }), { id: 's' })
    const happyCopy = { ...happy, id: 'other' }
    assert.deepEqual(
      planImport([happy], [happyCopy, sad], 'merge', 9).map((entry) => entry.id),
      ['s'],
    )
    const replaced = planImport([happy], [sad], 'replace', 9)
    assert.deepEqual(
      replaced.map((entry: StoredEntry) => [entry.id, entry.deletedAt]),
      [
        ['h', 9],
        ['s', null],
      ],
    )
  })
})

describe('sample words', () => {
  it('builds a linked multilingual cluster with stable ids', () => {
    const samples = sampleEntries(1000)
    assert.ok(samples.length > 50)
    assert.deepEqual(
      sampleEntries(2000).map((entry) => entry.id),
      samples.map((entry) => entry.id),
    )
    const lexicon = new Lexicon(samples)
    const happyId = sampleId('word', 'en', 'happy')
    const happy = lexicon.detail(happyId)!
    assert.equal(happy.displayLemma, 'happy')
    assert.ok(happy.links.some((link) => link.lemma === 'feliz' && link.toWordId))
    assert.equal(lexicon.stats(1000).phraseCount, 1)
    assert.ok(lexicon.graph().edges.length > 50)
  })
})

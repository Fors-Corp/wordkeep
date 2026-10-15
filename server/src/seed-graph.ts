import { db, findWordId, normalizeLemma } from './db.ts'
import { initialRecall } from '../../shared/sm2.ts'
import { insertPhrase, upsertLink } from './words.ts'
import type { LinkRelation, PhraseAnalysis, PhraseToken } from '../../shared/types.ts'

const LANG: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
}

type SeedWord = {
  lemma: string
  language: string
  languageName: string
  definition: string
  partOfSpeech: string
  synonyms: string[]
  antonyms: string[]
  related: string[]
}

function w(
  lemma: string,
  language: keyof typeof LANG,
  definition: string,
  extras: { synonyms?: string[]; antonyms?: string[]; related?: string[]; pos?: string } = {},
): SeedWord {
  return {
    lemma,
    language,
    languageName: LANG[language],
    definition,
    partOfSpeech: extras.pos ?? 'adjective',
    synonyms: extras.synonyms ?? [],
    antonyms: extras.antonyms ?? [],
    related: extras.related ?? [],
  }
}

const WORDS: SeedWord[] = [
  w('happy', 'en', 'Feeling or showing pleasure or contentment.', {
    synonyms: ['glad', 'joyful', 'cheerful'],
    antonyms: ['sad', 'unhappy'],
    related: ['love'],
  }),
  w('glad', 'en', 'Pleased; delighted.', {
    synonyms: ['happy', 'joyful'],
    antonyms: ['sad'],
  }),
  w('joyful', 'en', 'Feeling or causing great pleasure.', {
    synonyms: ['happy', 'glad', 'cheerful'],
    antonyms: ['sad'],
  }),
  w('cheerful', 'en', 'Noticeably happy and optimistic.', {
    synonyms: ['happy', 'joyful'],
    antonyms: ['unhappy'],
  }),
  w('sad', 'en', 'Feeling or showing sorrow.', {
    synonyms: ['unhappy'],
    antonyms: ['happy', 'glad', 'joyful'],
    related: ['hate'],
  }),
  w('unhappy', 'en', 'Not happy; sad or dissatisfied.', {
    synonyms: ['sad'],
    antonyms: ['happy', 'cheerful'],
  }),
  w('hot', 'en', 'Having a high temperature.', {
    synonyms: ['warm'],
    antonyms: ['cold', 'chilly'],
  }),
  w('warm', 'en', 'Of a fairly high temperature; comfortably heated.', {
    synonyms: ['hot'],
    antonyms: ['cold', 'chilly'],
  }),
  w('cold', 'en', 'Of or at a low temperature.', {
    synonyms: ['chilly'],
    antonyms: ['hot', 'warm'],
  }),
  w('chilly', 'en', 'Uncomfortably cool or cold.', {
    synonyms: ['cold'],
    antonyms: ['hot', 'warm'],
  }),
  w('big', 'en', 'Of considerable size or extent.', {
    synonyms: ['large'],
    antonyms: ['small', 'tiny'],
  }),
  w('large', 'en', 'Of considerable or relatively great size.', {
    synonyms: ['big'],
    antonyms: ['small', 'tiny'],
  }),
  w('small', 'en', 'Of a size that is less than normal or usual.', {
    synonyms: ['tiny'],
    antonyms: ['big', 'large'],
  }),
  w('tiny', 'en', 'Very small.', {
    synonyms: ['small'],
    antonyms: ['big', 'large'],
  }),
  w('light', 'en', 'Having a lot of light; not dark.', {
    synonyms: ['bright'],
    antonyms: ['dark', 'dim'],
  }),
  w('bright', 'en', 'Giving out or reflecting much light.', {
    synonyms: ['light'],
    antonyms: ['dark', 'dim'],
  }),
  w('dark', 'en', 'With little or no light.', {
    synonyms: ['dim'],
    antonyms: ['light', 'bright'],
  }),
  w('dim', 'en', 'Not shining brightly or clearly.', {
    synonyms: ['dark'],
    antonyms: ['light', 'bright'],
  }),
  w('love', 'en', 'An intense feeling of deep affection.', {
    synonyms: ['adore'],
    antonyms: ['hate'],
    related: ['happy'],
    pos: 'noun',
  }),
  w('adore', 'en', 'Love and respect deeply.', {
    synonyms: ['love'],
    antonyms: ['hate'],
    pos: 'verb',
  }),
  w('hate', 'en', 'Intense dislike.', {
    synonyms: [],
    antonyms: ['love', 'adore'],
    related: ['sad'],
    pos: 'noun',
  }),
  w('fast', 'en', 'Moving or able to move at high speed.', {
    synonyms: ['quick'],
    antonyms: ['slow'],
  }),
  w('quick', 'en', 'Moving fast or doing something in a short time.', {
    synonyms: ['fast'],
    antonyms: ['slow'],
  }),
  w('slow', 'en', 'Moving or operating at a low speed.', {
    synonyms: [],
    antonyms: ['fast', 'quick'],
  }),
  w('begin', 'en', 'Start; perform the first part of an action.', {
    synonyms: ['start'],
    antonyms: ['end', 'finish'],
    pos: 'verb',
  }),
  w('start', 'en', 'Begin or be begun.', {
    synonyms: ['begin'],
    antonyms: ['end', 'finish'],
    pos: 'verb',
  }),
  w('end', 'en', 'The final part of something; to bring to a close.', {
    synonyms: ['finish'],
    antonyms: ['begin', 'start'],
    pos: 'verb',
  }),
  w('finish', 'en', 'Bring a task or activity to an end.', {
    synonyms: ['end'],
    antonyms: ['begin', 'start'],
    pos: 'verb',
  }),
  w('know', 'en', 'Be aware of through observation, inquiry, or information.', {
    related: ['learn'],
    pos: 'verb',
  }),
  w('learn', 'en', 'Gain knowledge of or skill in by study or experience.', {
    related: ['know'],
    pos: 'verb',
  }),

  w('feliz', 'es', 'Que siente o causa felicidad.', {
    synonyms: ['alegre'],
    antonyms: ['triste'],
    related: ['amor'],
  }),
  w('alegre', 'es', 'Lleno de alegría.', {
    synonyms: ['feliz'],
    antonyms: ['triste'],
  }),
  w('triste', 'es', 'Afligido, pesaroso.', {
    synonyms: [],
    antonyms: ['feliz', 'alegre'],
  }),
  w('caliente', 'es', 'Que tiene o produce calor.', {
    antonyms: ['frío'],
  }),
  w('frío', 'es', 'De temperatura baja.', {
    antonyms: ['caliente'],
  }),
  w('grande', 'es', 'Que supera el tamaño habitual.', {
    antonyms: ['pequeño'],
  }),
  w('pequeño', 'es', 'De tamaño reducido.', {
    antonyms: ['grande'],
  }),
  w('amor', 'es', 'Sentimiento de afecto profundo.', {
    antonyms: ['odio'],
    related: ['feliz'],
    pos: 'noun',
  }),
  w('odio', 'es', 'Antipatía y aversión hacia algo o alguien.', {
    antonyms: ['amor'],
    pos: 'noun',
  }),

  w('heureux', 'fr', 'Qui éprouve du bonheur.', {
    synonyms: ['joyeux'],
    antonyms: ['malheureux'],
    related: ['amour'],
  }),
  w('joyeux', 'fr', 'Qui exprime la joie.', {
    synonyms: ['heureux'],
    antonyms: ['malheureux'],
  }),
  w('malheureux', 'fr', 'Qui n’est pas heureux; infortuné.', {
    antonyms: ['heureux', 'joyeux'],
  }),
  w('chaud', 'fr', 'De température élevée.', {
    antonyms: ['froid'],
  }),
  w('froid', 'fr', 'De température basse.', {
    antonyms: ['chaud'],
  }),
  w('grand', 'fr', 'De dimensions importantes.', {
    antonyms: ['petit'],
  }),
  w('petit', 'fr', 'De faible dimension.', {
    antonyms: ['grand'],
  }),
  w('amour', 'fr', 'Sentiment d’affection profonde.', {
    antonyms: ['haine'],
    related: ['heureux'],
    pos: 'noun',
  }),
  w('haine', 'fr', 'Sentiment violent de répulsion.', {
    antonyms: ['amour'],
    pos: 'noun',
  }),

  w('glücklich', 'de', 'Von Glück erfüllt; froh.', {
    antonyms: ['traurig'],
    related: ['Liebe'],
  }),
  w('traurig', 'de', 'Von Trauer erfüllt.', {
    antonyms: ['glücklich'],
  }),
  w('heiß', 'de', 'Von hoher Temperatur.', {
    antonyms: ['kalt'],
  }),
  w('kalt', 'de', 'Von niedriger Temperatur.', {
    antonyms: ['heiß'],
  }),
  w('groß', 'de', 'Von beträchtlicher Größe.', {
    antonyms: ['klein'],
  }),
  w('klein', 'de', 'Von geringem Ausmaß.', {
    antonyms: ['groß'],
  }),
  w('Liebe', 'de', 'Innige Zuneigung.', {
    antonyms: ['Hass'],
    related: ['glücklich'],
    pos: 'noun',
  }),
  w('Hass', 'de', 'Starke Abneigung.', {
    antonyms: ['Liebe'],
    pos: 'noun',
  }),
]

const CROSS: Array<{
  from: string
  fromLang: string
  to: string
  toLang: string
  relation: LinkRelation
}> = [
  { from: 'happy', fromLang: 'en', to: 'feliz', toLang: 'es', relation: 'translation' },
  { from: 'happy', fromLang: 'en', to: 'heureux', toLang: 'fr', relation: 'translation' },
  { from: 'happy', fromLang: 'en', to: 'glücklich', toLang: 'de', relation: 'translation' },
  { from: 'sad', fromLang: 'en', to: 'triste', toLang: 'es', relation: 'translation' },
  { from: 'sad', fromLang: 'en', to: 'malheureux', toLang: 'fr', relation: 'translation' },
  { from: 'sad', fromLang: 'en', to: 'traurig', toLang: 'de', relation: 'translation' },
  { from: 'hot', fromLang: 'en', to: 'caliente', toLang: 'es', relation: 'translation' },
  { from: 'hot', fromLang: 'en', to: 'chaud', toLang: 'fr', relation: 'translation' },
  { from: 'hot', fromLang: 'en', to: 'heiß', toLang: 'de', relation: 'translation' },
  { from: 'cold', fromLang: 'en', to: 'frío', toLang: 'es', relation: 'translation' },
  { from: 'cold', fromLang: 'en', to: 'froid', toLang: 'fr', relation: 'translation' },
  { from: 'cold', fromLang: 'en', to: 'kalt', toLang: 'de', relation: 'translation' },
  { from: 'big', fromLang: 'en', to: 'grande', toLang: 'es', relation: 'translation' },
  { from: 'big', fromLang: 'en', to: 'grand', toLang: 'fr', relation: 'translation' },
  { from: 'big', fromLang: 'en', to: 'groß', toLang: 'de', relation: 'translation' },
  { from: 'small', fromLang: 'en', to: 'pequeño', toLang: 'es', relation: 'translation' },
  { from: 'small', fromLang: 'en', to: 'petit', toLang: 'fr', relation: 'translation' },
  { from: 'small', fromLang: 'en', to: 'klein', toLang: 'de', relation: 'translation' },
  { from: 'love', fromLang: 'en', to: 'amor', toLang: 'es', relation: 'translation' },
  { from: 'love', fromLang: 'en', to: 'amour', toLang: 'fr', relation: 'translation' },
  { from: 'love', fromLang: 'en', to: 'Liebe', toLang: 'de', relation: 'translation' },
  { from: 'hate', fromLang: 'en', to: 'odio', toLang: 'es', relation: 'translation' },
  { from: 'hate', fromLang: 'en', to: 'haine', toLang: 'fr', relation: 'translation' },
  { from: 'hate', fromLang: 'en', to: 'Hass', toLang: 'de', relation: 'translation' },
  { from: 'feliz', fromLang: 'es', to: 'heureux', toLang: 'fr', relation: 'translation' },
  { from: 'feliz', fromLang: 'es', to: 'glücklich', toLang: 'de', relation: 'translation' },
  { from: 'heureux', fromLang: 'fr', to: 'glücklich', toLang: 'de', relation: 'translation' },
]

const SEED_NOTE = 'graph demo seed'

function upsertWord(seed: SeedWord): string {
  const existing = findWordId(seed.lemma, seed.language)
  if (existing) {
    const row = db
      .prepare('SELECT note, primary_sense_id FROM words WHERE id = ?')
      .get(existing) as { note: string; primary_sense_id: string | null } | undefined
    if (row?.note === SEED_NOTE && row.primary_sense_id) {
      db.prepare(
        `UPDATE senses SET part_of_speech = ?, definition = ?, synonyms_json = ?, antonyms_json = ?
         WHERE id = ?`,
      ).run(
        seed.partOfSpeech,
        seed.definition,
        JSON.stringify(seed.synonyms),
        JSON.stringify(seed.antonyms),
        row.primary_sense_id,
      )
    }
    return existing
  }

  const now = Date.now()
  const recall = initialRecall(now)
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO words (
      id, lemma, display_lemma, language, language_name, phonetic, etymology, note, forms_json,
      status, ease_factor, interval_days, repetitions, due_at, last_reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    normalizeLemma(seed.lemma, seed.language),
    seed.lemma,
    seed.language,
    seed.languageName,
    null,
    null,
    SEED_NOTE,
    '[]',
    recall.status,
    recall.easeFactor,
    recall.intervalDays,
    recall.repetitions,
    recall.dueAt,
    recall.lastReviewedAt,
    now,
    now,
  )
  const senseId = crypto.randomUUID()
  db.prepare(
    `INSERT INTO senses (id, word_id, part_of_speech, definition, synonyms_json, antonyms_json, tags_json, examples_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    senseId,
    id,
    seed.partOfSpeech,
    seed.definition,
    JSON.stringify(seed.synonyms),
    JSON.stringify(seed.antonyms),
    '[]',
    '[]',
  )
  db.prepare('UPDATE words SET primary_sense_id = ? WHERE id = ?').run(senseId, id)
  return id
}

function linkPair(
  fromId: string,
  from: SeedWord,
  toLemma: string,
  toLanguage: string,
  relation: LinkRelation,
) {
  upsertLink({
    fromId,
    toLemma,
    toLanguage,
    toLanguageName: LANG[toLanguage] ?? toLanguage,
    relation,
    fromLemma: from.lemma,
    fromLanguage: from.language,
    fromLanguageName: from.languageName,
  })
}

export function seedGraphDemo(): { created: number; linked: number } {
  const ids = new Map<string, string>()
  for (const word of WORDS) {
    ids.set(`${word.language}:${normalizeLemma(word.lemma, word.language)}`, upsertWord(word))
  }

  let linked = 0
  for (const word of WORDS) {
    const fromId = ids.get(`${word.language}:${normalizeLemma(word.lemma, word.language)}`)
    if (!fromId) continue
    for (const term of word.synonyms) {
      linkPair(fromId, word, term, word.language, 'synonym')
      linked += 1
    }
    for (const term of word.antonyms) {
      linkPair(fromId, word, term, word.language, 'antonym')
      linked += 1
    }
    for (const term of word.related) {
      linkPair(fromId, word, term, word.language, 'related')
      linked += 1
    }
  }
  for (const link of CROSS) {
    const fromId = ids.get(`${link.fromLang}:${normalizeLemma(link.from, link.fromLang)}`)
    if (!fromId) continue
    const from = WORDS.find(
      (word) => word.language === link.fromLang && normalizeLemma(word.lemma, word.language) === normalizeLemma(link.from, link.fromLang),
    )
    if (!from) continue
    linkPair(fromId, from, link.to, link.toLang, link.relation)
    linked += 1
  }
  const phrase = seedPhrase() ? 1 : 0
  return { created: WORDS.length + phrase, linked }
}

function seedToken(
  index: number,
  start: number,
  text: string,
  fields: Partial<PhraseToken>,
): PhraseToken {
  return {
    index,
    start,
    text,
    lemma: text.toLowerCase(),
    partOfSpeech: '',
    features: [],
    role: '',
    gloss: '',
    explanation: '',
    known: true,
    punct: false,
    ...fields,
  }
}

export const DEMO_PHRASE: PhraseAnalysis = {
  text: 'I am very happy.',
  language: 'en',
  languageName: 'English',
  source: 'dictionary',
  translation: 'I feel a great deal of joy.',
  summary: 'A copular sentence: the subject “I” is linked by “am” to the adjective phrase “very happy”.',
  sentenceType: 'declarative',
  tense: 'present simple',
  mood: 'indicative',
  voice: 'active',
  clauses: [{ text: 'I am very happy', type: 'main', explanation: 'A single main clause.' }],
  idioms: [],
  tokens: [
    seedToken(0, 0, 'I', {
      lemma: 'I',
      partOfSpeech: 'pronoun',
      role: 'subject',
      features: ['first person', 'singular', 'nominative'],
      gloss: 'The speaker or writer.',
      explanation: 'The subject: who is happy.',
    }),
    seedToken(1, 2, 'am', {
      lemma: 'be',
      partOfSpeech: 'verb',
      role: 'predicate (copula)',
      features: ['first person', 'singular', 'present', 'indicative'],
      gloss: 'To have a quality or state.',
      explanation: 'Links the subject to its description.',
    }),
    seedToken(2, 5, 'very', {
      partOfSpeech: 'adverb',
      role: 'modifier',
      gloss: 'To a high degree.',
      explanation: 'Intensifies “happy”.',
    }),
    seedToken(3, 10, 'happy', {
      partOfSpeech: 'adjective',
      role: 'subject complement',
      features: ['positive degree'],
      gloss: 'Feeling or showing pleasure or contentment.',
      explanation: 'Describes the subject after the copula.',
    }),
    seedToken(4, 15, '.', { lemma: '.', partOfSpeech: 'punctuation', known: false, punct: true }),
  ],
  questions: [
    { question: 'What is the role of “am” in this sentence?', answer: 'Copula linking the subject to “very happy”.' },
    { question: 'Which word does “very” modify?', answer: '“happy”' },
    { question: 'What tense is the sentence in?', answer: 'Present simple' },
  ],
  clozeIndexes: [1, 3],
  note: 'Demo phrase with a hand-written analysis.',
  notice: { code: 'demo' },
  existing: null,
}

function seedPhrase(): boolean {
  if (findWordId(DEMO_PHRASE.text, DEMO_PHRASE.language)) return false
  insertPhrase(DEMO_PHRASE, DEMO_PHRASE.translation, SEED_NOTE)
  return true
}

const runningDirect = process.argv[1]?.includes('seed-graph')
if (runningDirect) {
  const result = seedGraphDemo()
  console.log(`Graph seed: ${result.created} words, ${result.linked} links`)
}

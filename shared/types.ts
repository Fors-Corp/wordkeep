export type RecallStatus = 'new' | 'learning' | 'review' | 'mastered'

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export type EntryKind = 'word' | 'phrase'

export type Language = {
  code: string
  name: string
  words: number
}

export type WordForm = {
  word: string
  tags: string[]
}

export type SenseDraft = {
  partOfSpeech: string
  definition: string
  examples: string[]
  synonyms: string[]
  antonyms: string[]
  tags: string[]
}

export type TranslationDraft = {
  lemma: string
  language: string
  languageName: string
}

export type LookupResult = {
  lemma: string
  displayLemma: string
  language: string
  languageName: string
  phonetic: string | null
  etymology: string | null
  fallbackFrom: string | null
  forms: WordForm[]
  senses: SenseDraft[]
  translations: TranslationDraft[]
  existing: { id: string } | null
}

export type Sense = SenseDraft & {
  id: string
  sortOrder: number
}

export type LinkRelation = 'translation' | 'synonym' | 'antonym' | 'related' | 'phrase'

export type WordLink = TranslationDraft & {
  id: string
  toWordId: string | null
  relation: LinkRelation
}

export type WordSummary = {
  id: string
  kind: EntryKind
  lemma: string
  displayLemma: string
  language: string
  languageName: string
  phonetic: string | null
  gloss: string
  status: RecallStatus
  dueAt: number
  archivedAt: number | null
  lastReviewedAt: number | null
  createdAt: number
}

export type WordDetail = WordSummary & {
  etymology: string | null
  note: string
  primarySenseId: string | null
  easeFactor: number
  intervalDays: number
  repetitions: number
  updatedAt: number
  forms: WordForm[]
  senses: Sense[]
  links: WordLink[]
  analysis: PhraseAnalysis | null
}

export type KeepWordInput = {
  q: string
  lang: string
  note?: string
  primarySenseIndex?: number
}

export type Stats = {
  dueToday: number
  newCount: number
  lexiconCount: number
  languageCount: number
  phraseCount: number
}

export type GraphNode = {
  id: string
  label: string
  language: string
  languageName: string
  saved: boolean
  wordId: string | null
  kind:
    | 'center'
    | 'translation'
    | 'synonym'
    | 'antonym'
    | 'related'
    | 'etymology'
    | 'saved'
    | 'phrase'
    | 'word'
}

export type GraphEdge = {
  source: string
  target: string
  relation: LinkRelation
}

export type GraphPayload = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type PlayCard = {
  id: string
  lemma: string
  definition: string
  partOfSpeech: string
}

export type PlayRound = {
  lang: string
  languageName: string
  bankSize: number
  cards: PlayCard[]
}

export type Suggestion = {
  lemma: string
  language: string
  languageName: string
  exact: boolean
}

export type SuggestResponse = {
  query: string
  detected: Array<{ code: string; name: string }>
  suggestions: Suggestion[]
}

export type PhraseToken = {
  index: number
  start: number
  text: string
  lemma: string
  partOfSpeech: string
  features: string[]
  role: string
  gloss: string
  explanation: string
  known: boolean
  punct: boolean
}

export type PhraseClause = {
  text: string
  type: string
  explanation: string
}

export type PhraseIdiom = {
  text: string
  meaning: string
}

export type GrammarQuestion = {
  question: string
  answer: string
}

export type PhraseAnalysis = {
  text: string
  language: string
  languageName: string
  source: 'dictionary' | 'claude'
  translation: string
  summary: string
  sentenceType: string
  tense: string
  mood: string
  voice: string
  clauses: PhraseClause[]
  idioms: PhraseIdiom[]
  tokens: PhraseToken[]
  questions: GrammarQuestion[]
  clozeIndexes: number[]
  note: string | null
  existing: { id: string } | null
}

export type KeepPhraseInput = {
  text: string
  lang: string
  explain?: string
  note?: string
}

import { isContentToken } from './phrase.ts'
import { applyGrade, initialRecall } from './sm2.ts'
import type {
  EntryKind,
  Grade,
  GrammarQuestion,
  GraphNode,
  GraphPayload,
  LinkRelation,
  LookupResult,
  PhraseAnalysis,
  PhraseNotice,
  RecallStatus,
  Sense,
  Stats,
  WordDetail,
  WordForm,
  WordLink,
  WordSummary,
} from './types.ts'

/**
 * The lexicon as it lives on the device (and in sync): one self-contained
 * record per word or phrase. Links name their target by lemma and language;
 * whether that target is kept is worked out when reading, so a record never
 * has to change because another one was kept or deleted.
 */
export type StoredLink = {
  lemma: string
  language: string
  languageName: string
  relation: LinkRelation
}

export type StoredEntry = {
  id: string
  kind: EntryKind
  lemma: string
  displayLemma: string
  language: string
  languageName: string
  phonetic: string | null
  etymology: string | null
  note: string
  primarySenseId: string | null
  archivedAt: number | null
  status: RecallStatus
  easeFactor: number
  intervalDays: number
  repetitions: number
  dueAt: number
  lastReviewedAt: number | null
  createdAt: number
  updatedAt: number
  /** Set when deleted, so the deletion can sync to other devices. */
  deletedAt: number | null
  forms: WordForm[]
  senses: Sense[]
  links: StoredLink[]
  analysis: PhraseAnalysis | null
}

export type LexiconBackupV2 = {
  version: 2
  exportedAt: number
  entries: StoredEntry[]
}

export function normalizeLemma(word: string, language: string): string {
  const trimmed = word.trim().normalize('NFC')
  try {
    return trimmed.toLocaleLowerCase(language)
  } catch {
    return trimmed.toLocaleLowerCase('en')
  }
}

function keyOf(lemma: string, language: string): string {
  return `${language}:${normalizeLemma(lemma, language)}`
}

/** A short hash that is the same on every device and every run. */
export function stableHash(...parts: string[]): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (const char of parts.join('\u0000')) {
    const code = char.codePointAt(0) ?? 0
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/**
 * The id of the entry for a word or phrase. It depends only on the language
 * and the normalized text, so the same word kept on two devices (or loaded
 * from the samples) becomes one record when they sync, not two.
 */
export function entryId(language: string, lemma: string): string {
  return `e-${stableHash(language, normalizeLemma(lemma, language))}`
}

function uniqueLinks(links: StoredLink[]): StoredLink[] {
  const seen = new Set<string>()
  return links.filter((link) => {
    if (!link.lemma.trim()) return false
    const key = `${link.relation}|${keyOf(link.lemma, link.language)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A new record for a dictionary entry the reader decided to keep. */
export function entryFromLookup(
  lookup: LookupResult,
  options: { note?: string; primarySenseIndex?: number; now?: number; id?: string } = {},
): StoredEntry {
  const now = options.now ?? Date.now()
  const id = options.id ?? entryId(lookup.language, lookup.displayLemma)
  const senses: Sense[] = lookup.senses.map((sense, index) => ({
    ...sense,
    id: `${id}-s${index}`,
    sortOrder: index,
  }))
  const synonyms = new Set<string>()
  const antonyms = new Set<string>()
  for (const sense of lookup.senses) {
    for (const term of sense.synonyms ?? []) synonyms.add(term)
    for (const term of sense.antonyms ?? []) antonyms.add(term)
  }
  const own = (lemma: string, relation: LinkRelation): StoredLink => ({
    lemma,
    language: lookup.language,
    languageName: lookup.languageName,
    relation,
  })
  const links = uniqueLinks([
    ...lookup.translations.slice(0, 40).map((item) => ({
      lemma: item.lemma,
      language: item.language,
      languageName: item.languageName,
      relation: 'translation' as const,
    })),
    ...[...synonyms].slice(0, 12).map((term) => own(term, 'synonym')),
    ...[...antonyms].slice(0, 12).map((term) => own(term, 'antonym')),
  ])
  return {
    id,
    kind: 'word',
    lemma: lookup.lemma || normalizeLemma(lookup.displayLemma, lookup.language),
    displayLemma: lookup.displayLemma.trim(),
    language: lookup.language,
    languageName: lookup.languageName,
    phonetic: lookup.phonetic,
    etymology: lookup.etymology,
    note: options.note ?? '',
    primarySenseId: senses[options.primarySenseIndex ?? 0]?.id ?? senses[0]?.id ?? null,
    archivedAt: null,
    ...initialRecall(now),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    forms: lookup.forms ?? [],
    senses,
    links,
    analysis: null,
  }
}

function phraseSense(id: string, analysis: PhraseAnalysis, gloss: string): Sense {
  return {
    id: `${id}-sense`,
    sortOrder: 0,
    partOfSpeech: 'phrase',
    definition: gloss,
    tags: [analysis.sentenceType, analysis.tense, analysis.mood, analysis.voice]
      .map((item) => item.trim())
      .filter(Boolean),
    examples: analysis.idioms.map((item) => `${item.text} — ${item.meaning}`).slice(0, 4),
    synonyms: [],
    antonyms: [],
  }
}

function phraseLinks(analysis: PhraseAnalysis): StoredLink[] {
  const self = normalizeLemma(analysis.text, analysis.language)
  const links: StoredLink[] = []
  for (const token of analysis.tokens) {
    const trusted = token.known || (analysis.source === 'claude' && token.partOfSpeech)
    if (!trusted || !isContentToken(token)) continue
    if (normalizeLemma(token.lemma, analysis.language) === self) continue
    links.push({
      lemma: token.lemma,
      language: analysis.language,
      languageName: analysis.languageName,
      relation: 'phrase',
    })
  }
  return uniqueLinks(links).slice(0, 12)
}

function storedAnalysis(analysis: PhraseAnalysis): PhraseAnalysis {
  return { ...analysis, existing: null }
}

/** A new record for a phrase the reader decided to keep, linked to its key words. */
export function entryFromPhrase(
  analysis: PhraseAnalysis,
  gloss: string,
  options: { note?: string; now?: number; id?: string } = {},
): StoredEntry {
  const now = options.now ?? Date.now()
  const display = analysis.text.trim()
  const id = options.id ?? entryId(analysis.language, display)
  const sense = phraseSense(id, analysis, gloss)
  return {
    id,
    kind: 'phrase',
    lemma: normalizeLemma(display, analysis.language),
    displayLemma: display,
    language: analysis.language,
    languageName: analysis.languageName,
    phonetic: null,
    etymology: null,
    note: options.note ?? '',
    primarySenseId: sense.id,
    archivedAt: null,
    ...initialRecall(now),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    forms: [],
    senses: [sense],
    links: phraseLinks(analysis),
    analysis: storedAnalysis(analysis),
  }
}

/**
 * The time to stamp on a changed record: now, but always later than the copy
 * it was changed from, so an edit wins over the version it started from even
 * when this device's clock runs behind another's.
 */
function stamp(entry: StoredEntry, now: number): number {
  return Math.max(now, entry.updatedAt + 1)
}

export function withPhraseAnalysis(
  entry: StoredEntry,
  analysis: PhraseAnalysis,
  gloss: string,
  now = Date.now(),
): StoredEntry {
  const sense = phraseSense(entry.id, analysis, gloss)
  return {
    ...entry,
    analysis: storedAnalysis(analysis),
    senses: [sense],
    primarySenseId: sense.id,
    links: phraseLinks(analysis),
    updatedAt: stamp(entry, now),
  }
}

export type EntryPatch = {
  note?: string
  primarySenseId?: string
  etymology?: string
  archived?: boolean
}

export function withPatch(entry: StoredEntry, patch: EntryPatch, now = Date.now()): StoredEntry {
  return {
    ...entry,
    note: patch.note ?? entry.note,
    primarySenseId: patch.primarySenseId ?? entry.primarySenseId,
    etymology: patch.etymology ?? entry.etymology,
    archivedAt: patch.archived === undefined ? entry.archivedAt : patch.archived ? now : null,
    updatedAt: stamp(entry, now),
  }
}

export function withGrade(entry: StoredEntry, grade: Grade, now = Date.now()): StoredEntry {
  return { ...entry, ...applyGrade(entry, grade, now), updatedAt: stamp(entry, now) }
}

export function tombstone(entry: StoredEntry, now = Date.now()): StoredEntry {
  return { ...entry, deletedAt: now, updatedAt: stamp(entry, now) }
}

export type ListOptions = {
  q?: string
  status?: string
  due?: string
  language?: string
  kind?: string
  archived?: boolean
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

/** Read-only view over the device's records: lists, details, review, stats, and the atlas. */
export class Lexicon {
  private readonly active: StoredEntry[]
  private readonly byId = new Map<string, StoredEntry>()
  private readonly byKey = new Map<string, string>()
  /** Who links to a word: target key → the records whose links name it. */
  private readonly linkedFrom = new Map<string, Array<{ from: StoredEntry; relation: LinkRelation }>>()

  constructor(entries: Iterable<StoredEntry>) {
    this.active = [...entries].filter((entry) => !entry.deletedAt)
    for (const entry of this.active) {
      this.byId.set(entry.id, entry)
      const key = keyOf(entry.displayLemma, entry.language)
      if (!this.byKey.has(key)) this.byKey.set(key, entry.id)
    }
    for (const entry of this.active) {
      for (const link of entry.links) {
        const target = keyOf(link.lemma, link.language)
        const list = this.linkedFrom.get(target)
        if (list) list.push({ from: entry, relation: link.relation })
        else this.linkedFrom.set(target, [{ from: entry, relation: link.relation }])
      }
    }
  }

  get size(): number {
    return this.active.length
  }

  entries(): StoredEntry[] {
    return this.active
  }

  raw(id: string): StoredEntry | null {
    return this.byId.get(id) ?? null
  }

  findId(lemma: string, language: string): string | null {
    return this.byKey.get(keyOf(lemma, language)) ?? null
  }

  private gloss(entry: StoredEntry): string {
    const primary = entry.senses.find((sense) => sense.id === entry.primarySenseId)
    return (primary ?? entry.senses[0])?.definition ?? ''
  }

  private summary(entry: StoredEntry): WordSummary {
    return {
      id: entry.id,
      kind: entry.kind,
      lemma: entry.lemma,
      displayLemma: entry.displayLemma,
      language: entry.language,
      languageName: entry.languageName,
      phonetic: entry.phonetic,
      gloss: this.gloss(entry),
      status: entry.status,
      dueAt: entry.dueAt,
      archivedAt: entry.archivedAt,
      lastReviewedAt: entry.lastReviewedAt,
      createdAt: entry.createdAt,
    }
  }

  /** Own links plus links other kept records make to this one, with kept targets resolved. */
  private links(entry: StoredEntry): WordLink[] {
    const out: WordLink[] = []
    const seen = new Set<string>()
    const selfKey = keyOf(entry.displayLemma, entry.language)
    const push = (link: StoredLink, toWordId: string | null) => {
      const key = `${link.relation}|${keyOf(link.lemma, link.language)}`
      if (seen.has(key) || keyOf(link.lemma, link.language) === selfKey) return
      seen.add(key)
      out.push({
        id: `${entry.id}|${key}`,
        lemma: link.lemma,
        language: link.language,
        languageName: link.languageName,
        relation: link.relation,
        toWordId,
      })
    }
    for (const link of entry.links) push(link, this.findId(link.lemma, link.language))
    for (const { from: other, relation } of this.linkedFrom.get(selfKey) ?? []) {
      if (other.id === entry.id) continue
      push(
        {
          lemma: other.displayLemma,
          language: other.language,
          languageName: other.languageName,
          relation,
        },
        other.id,
      )
    }
    return out.sort((a, b) => collator.compare(a.languageName, b.languageName))
  }

  detail(id: string): WordDetail | null {
    const entry = this.byId.get(id)
    if (!entry) return null
    return {
      ...this.summary(entry),
      etymology: entry.etymology,
      note: entry.note,
      primarySenseId: entry.primarySenseId,
      easeFactor: entry.easeFactor,
      intervalDays: entry.intervalDays,
      repetitions: entry.repetitions,
      updatedAt: entry.updatedAt,
      forms: entry.forms,
      senses: entry.senses,
      links: this.links(entry),
      analysis: entry.analysis ? { ...entry.analysis, existing: { id: entry.id } } : null,
    }
  }

  list(options: ListOptions = {}, now = Date.now()): WordSummary[] {
    const q = options.q?.trim().toLowerCase()
    return this.active
      .filter((entry) => {
        if (options.archived) {
          if (!entry.archivedAt) return false
        } else if (options.status !== 'archived' && entry.archivedAt) return false
        if (options.status === 'archived' && !entry.archivedAt) return false
        if (options.status && !['all', 'archived'].includes(options.status) && entry.status !== options.status) {
          return false
        }
        if (options.due === 'today' && (entry.dueAt > now || entry.archivedAt)) return false
        if (options.language && entry.language !== options.language) return false
        if ((options.kind === 'word' || options.kind === 'phrase') && entry.kind !== options.kind) return false
        if (q) {
          const haystack = `${entry.displayLemma}\n${entry.lemma}\n${entry.note}`.toLowerCase()
          if (!haystack.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => collator.compare(a.displayLemma, b.displayLemma))
      .map((entry) => this.summary(entry))
  }

  recent(limit = 6): WordSummary[] {
    return this.active
      .filter((entry) => !entry.archivedAt)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((entry) => this.summary(entry))
  }

  reviewQueue(now = Date.now()): WordDetail[] {
    return this.active
      .filter((entry) => !entry.archivedAt && entry.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt)
      .map((entry) => this.detail(entry.id)!)
  }

  stats(now = Date.now()): Stats {
    const current = this.active.filter((entry) => !entry.archivedAt)
    return {
      dueToday: current.filter((entry) => entry.dueAt <= now).length,
      newCount: current.filter((entry) => entry.status === 'new').length,
      lexiconCount: current.length,
      languageCount: new Set(current.map((entry) => entry.language)).size,
      phraseCount: current.filter((entry) => entry.kind === 'phrase').length,
    }
  }

  graph(centerId?: string): GraphPayload {
    return centerId ? this.centerGraph(centerId) : this.wholeGraph()
  }

  private centerGraph(centerId: string): GraphPayload {
    const center = this.detail(centerId)
    if (!center) return { nodes: [], edges: [] }
    const centerNodeId = `word:${center.id}`
    const nodes: GraphNode[] = [
      {
        id: centerNodeId,
        label: center.displayLemma,
        language: center.language,
        languageName: center.languageName,
        saved: true,
        wordId: center.id,
        kind: 'center',
      },
    ]
    const edges: GraphPayload['edges'] = []
    const seenNode = new Set([centerNodeId])
    const seenEdge = new Set<string>()
    for (const link of center.links) {
      const id = link.toWordId ? `word:${link.toWordId}` : `ghost:${link.language}:${link.lemma}`
      if (!seenNode.has(id)) {
        seenNode.add(id)
        const target = link.toWordId ? this.byId.get(link.toWordId) : undefined
        const kind: GraphNode['kind'] =
          link.relation === 'phrase'
            ? target?.kind === 'phrase'
              ? 'phrase'
              : target
                ? 'saved'
                : 'related'
            : link.relation
        nodes.push({
          id,
          label: link.lemma,
          language: link.language,
          languageName: link.languageName,
          saved: Boolean(link.toWordId),
          wordId: link.toWordId,
          kind,
        })
      }
      const edgeKey = [centerNodeId, id, link.relation].sort().join('|')
      if (seenEdge.has(edgeKey)) continue
      seenEdge.add(edgeKey)
      edges.push({ source: centerNodeId, target: id, relation: link.relation })
    }
    return { nodes, edges }
  }

  private wholeGraph(): GraphPayload {
    const words = this.active.filter((entry) => !entry.archivedAt)
    const nodes: GraphNode[] = words.map((entry) => ({
      id: `word:${entry.id}`,
      label: entry.displayLemma,
      language: entry.language,
      languageName: entry.languageName,
      saved: true,
      wordId: entry.id,
      kind: entry.kind === 'phrase' ? 'phrase' : 'saved',
    }))
    const nodeIds = new Set(nodes.map((node) => node.id))
    const edges: GraphPayload['edges'] = []
    const edgeSeen = new Set<string>()
    const pushEdge = (source: string, target: string, relation: LinkRelation) => {
      if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return
      const key = [source, target, relation].sort().join('|')
      if (edgeSeen.has(key)) return
      edgeSeen.add(key)
      edges.push({ source, target, relation })
    }

    for (const entry of words) {
      const source = `word:${entry.id}`
      for (const link of entry.links) {
        const targetId = this.findId(link.lemma, link.language)
        if (targetId) {
          pushEdge(source, `word:${targetId}`, link.relation)
          continue
        }
        // Words of a kept phrase show up even when they were never kept themselves.
        if (link.relation !== 'phrase' || entry.kind !== 'phrase') continue
        const ghostId = `ghost:${link.language}:${normalizeLemma(link.lemma, link.language)}`
        if (!nodeIds.has(ghostId)) {
          nodeIds.add(ghostId)
          nodes.push({
            id: ghostId,
            label: link.lemma,
            language: link.language,
            languageName: link.languageName,
            saved: false,
            wordId: null,
            kind: 'word',
          })
        }
        pushEdge(source, ghostId, 'phrase')
      }
      for (const sense of entry.senses) {
        for (const term of sense.synonyms.slice(0, 8)) {
          const other = this.findId(term, entry.language)
          if (other) pushEdge(source, `word:${other}`, 'synonym')
        }
        for (const term of sense.antonyms.slice(0, 8)) {
          const other = this.findId(term, entry.language)
          if (other) pushEdge(source, `word:${other}`, 'antonym')
        }
      }
    }
    return { nodes, edges }
  }

  backup(now = Date.now()): LexiconBackupV2 {
    return { version: 2, exportedAt: now, entries: this.active }
  }
}

/* ------------------------------------------------------------------ */
/* Backups: the current format (v2) and the old server format (v1).   */

type V1Row = Record<string, unknown>

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function list(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const STATUSES: RecallStatus[] = ['new', 'learning', 'review', 'mastered']

/** Turns a backup exported by the old server (rows of words, senses, links) into records. */
function fromV1(raw: { words: V1Row[]; senses: V1Row[]; links: V1Row[] }): StoredEntry[] {
  const senses = new Map<string, Sense[]>()
  for (const row of raw.senses) {
    const wordId = str(row.word_id)
    const group = senses.get(wordId) ?? []
    group.push({
      id: str(row.id),
      partOfSpeech: str(row.part_of_speech),
      definition: str(row.definition),
      examples: list(row.examples_json),
      synonyms: list(row.synonyms_json),
      antonyms: list(row.antonyms_json),
      tags: list(row.tags_json),
      sortOrder: num(row.sort_order),
    })
    senses.set(wordId, group)
  }
  const links = new Map<string, StoredLink[]>()
  for (const row of raw.links) {
    const from = str(row.from_word_id)
    const group = links.get(from) ?? []
    group.push({
      lemma: str(row.to_lemma),
      language: str(row.to_language),
      languageName: str(row.to_language_name, str(row.to_language)),
      relation: (str(row.relation, 'translation') as LinkRelation) || 'translation',
    })
    links.set(from, group)
  }
  return raw.words.map((row) => {
    const id = str(row.id)
    const now = Date.now()
    const status = str(row.status) as RecallStatus
    const kind: EntryKind = row.kind === 'phrase' ? 'phrase' : 'word'
    const analysis = kind === 'phrase' ? parseJson<PhraseAnalysis | null>(row.analysis_json, null) : null
    return {
      id,
      kind,
      lemma: str(row.lemma),
      displayLemma: str(row.display_lemma, str(row.lemma)),
      language: str(row.language),
      languageName: str(row.language_name, str(row.language)),
      phonetic: typeof row.phonetic === 'string' ? row.phonetic : null,
      etymology: typeof row.etymology === 'string' ? row.etymology : null,
      note: str(row.note),
      primarySenseId: typeof row.primary_sense_id === 'string' ? row.primary_sense_id : null,
      archivedAt: nullableNum(row.archived_at),
      status: STATUSES.includes(status) ? status : 'new',
      easeFactor: num(row.ease_factor, 2.5),
      intervalDays: num(row.interval_days),
      repetitions: num(row.repetitions),
      dueAt: num(row.due_at, now),
      lastReviewedAt: nullableNum(row.last_reviewed_at),
      createdAt: num(row.created_at, now),
      updatedAt: num(row.updated_at, now),
      deletedAt: null,
      forms: parseJson<WordForm[]>(row.forms_json, []),
      senses: (senses.get(id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
      links: uniqueLinks(links.get(id) ?? []),
      analysis: analysis && Array.isArray(analysis.tokens) ? { ...analysis, existing: null } : null,
    }
  })
}

const RELATIONS: LinkRelation[] = ['translation', 'synonym', 'antonym', 'related', 'phrase']

function strings(value: unknown, max = 200): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : []
}

function objects(value: unknown, max = 500): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object').slice(0, max)
    : []
}

function cleanNotice(raw: unknown): PhraseNotice | null {
  if (!raw || typeof raw !== 'object') return null
  const notice = raw as PhraseNotice
  if (typeof notice.code !== 'string') return null
  const params: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(notice.params ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') params[key] = value
  }
  return Object.keys(params).length ? { code: notice.code, params } : { code: notice.code }
}

function cleanAnalysis(raw: unknown): PhraseAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (!Array.isArray(a.tokens)) return null
  return {
    text: str(a.text),
    language: str(a.language),
    languageName: str(a.languageName, str(a.language)),
    source: a.source === 'claude' ? 'claude' : 'dictionary',
    translation: str(a.translation),
    summary: str(a.summary),
    sentenceType: str(a.sentenceType),
    tense: str(a.tense),
    mood: str(a.mood),
    voice: str(a.voice),
    clauses: objects(a.clauses, 40).map((c) => ({ text: str(c.text), type: str(c.type), explanation: str(c.explanation) })),
    idioms: objects(a.idioms, 40).map((i) => ({ text: str(i.text), meaning: str(i.meaning) })),
    tokens: objects(a.tokens, 200).map((t, index) => ({
      index: num(t.index, index),
      start: num(t.start),
      text: str(t.text),
      lemma: str(t.lemma, str(t.text)),
      partOfSpeech: str(t.partOfSpeech),
      features: strings(t.features, 20),
      role: str(t.role),
      gloss: str(t.gloss),
      explanation: str(t.explanation),
      known: t.known === true,
      punct: t.punct === true,
    })),
    questions: objects(a.questions, 40).map((q) => {
      const question: GrammarQuestion = { question: str(q.question), answer: str(q.answer) }
      const tpl = q.template as Record<string, unknown> | undefined
      if (tpl && typeof tpl === 'object' && (tpl.kind === 'form' || tpl.kind === 'pos')) {
        question.template = {
          kind: tpl.kind,
          text: str(tpl.text),
          lemma: str(tpl.lemma),
          partOfSpeech: str(tpl.partOfSpeech),
          features: strings(tpl.features, 20),
        }
      }
      return question
    }),
    clozeIndexes: Array.isArray(a.clozeIndexes)
      ? a.clozeIndexes.filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
      : [],
    note: typeof a.note === 'string' ? a.note : null,
    notice: cleanNotice(a.notice),
    existing: null,
  }
}

/**
 * A record from outside this device (a backup file, another device, an old
 * copy in storage) with every field checked and filled, or null when it is
 * not a word or phrase at all. Everything that reads records can then rely
 * on their shape.
 */
export function normalizeEntry(raw: unknown): StoredEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const id = str(e.id)
  const displayLemma = str(e.displayLemma).trim()
  const language = str(e.language).trim()
  if (!id || id.length > 200 || !displayLemma || !language) return null
  const now = Date.now()
  const createdAt = num(e.createdAt, now)
  const status = str(e.status) as RecallStatus
  const senses: Sense[] = objects(e.senses, 100).map((sense, index) => ({
    id: str(sense.id, `${id}-s${index}`) || `${id}-s${index}`,
    partOfSpeech: str(sense.partOfSpeech),
    definition: str(sense.definition),
    examples: strings(sense.examples, 40),
    synonyms: strings(sense.synonyms, 60),
    antonyms: strings(sense.antonyms, 60),
    tags: strings(sense.tags, 20),
    sortOrder: num(sense.sortOrder, index),
  }))
  const links: StoredLink[] = objects(e.links, 400)
    .filter((link) => typeof link.lemma === 'string' && link.lemma.trim() && typeof link.language === 'string')
    .map((link) => ({
      lemma: str(link.lemma),
      language: str(link.language),
      languageName: str(link.languageName, str(link.language)),
      relation: RELATIONS.includes(link.relation as LinkRelation) ? (link.relation as LinkRelation) : 'related',
    }))
  const primary = str(e.primarySenseId)
  return {
    id,
    kind: e.kind === 'phrase' ? 'phrase' : 'word',
    lemma: str(e.lemma) || normalizeLemma(displayLemma, language),
    displayLemma,
    language,
    languageName: str(e.languageName, language) || language,
    phonetic: typeof e.phonetic === 'string' ? e.phonetic : null,
    etymology: typeof e.etymology === 'string' ? e.etymology : null,
    note: str(e.note),
    primarySenseId: senses.some((sense) => sense.id === primary) ? primary : (senses[0]?.id ?? null),
    archivedAt: nullableNum(e.archivedAt),
    status: STATUSES.includes(status) ? status : 'new',
    easeFactor: Math.max(1.3, num(e.easeFactor, 2.5)),
    intervalDays: Math.max(0, num(e.intervalDays)),
    repetitions: Math.max(0, Math.floor(num(e.repetitions))),
    dueAt: num(e.dueAt, createdAt),
    lastReviewedAt: nullableNum(e.lastReviewedAt),
    createdAt,
    updatedAt: num(e.updatedAt, createdAt),
    deletedAt: nullableNum(e.deletedAt),
    forms: objects(e.forms, 60)
      .filter((form) => typeof form.word === 'string')
      .map((form) => ({ word: str(form.word), tags: strings(form.tags, 20) })),
    senses,
    links: uniqueLinks(links),
    analysis: cleanAnalysis(e.analysis),
  }
}

/** Reads a backup file in either format. Throws on anything else. */
export function readBackup(raw: unknown): StoredEntry[] {
  if (raw && typeof raw === 'object') {
    const body = raw as { version?: unknown; entries?: unknown; words?: unknown; senses?: unknown; links?: unknown }
    if (body.version === 2 && Array.isArray(body.entries)) {
      const entries = body.entries.map(normalizeEntry).filter((entry): entry is StoredEntry => entry !== null)
      if (entries.length || !body.entries.length) return entries
    }
    if (body.version === 1 && Array.isArray(body.words) && Array.isArray(body.senses) && Array.isArray(body.links)) {
      return fromV1(body as { words: V1Row[]; senses: V1Row[]; links: V1Row[] })
        .map(normalizeEntry)
        .filter((entry): entry is StoredEntry => entry !== null)
    }
  }
  throw new Error('Invalid backup file')
}

/**
 * The records to write for an import.
 * - merge adds what is not there yet and keeps each record's own timestamp,
 *   so a backup never overrides newer changes made on another device; a
 *   record deleted here comes back, stamped later than its deletion.
 * - replace makes the lexicon match the file: everything else is deleted, and
 *   the file's records are stamped now so they win everywhere.
 */
export function planImport(
  current: StoredEntry[],
  incoming: StoredEntry[],
  mode: 'merge' | 'replace',
  now = Date.now(),
): StoredEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]))
  const live = current.filter((entry) => !entry.deletedAt)
  if (mode === 'replace') {
    const keep = new Set(incoming.map((entry) => entry.id))
    return [
      ...live.filter((entry) => !keep.has(entry.id)).map((entry) => tombstone(entry, now)),
      ...incoming.map((entry) => {
        const local = byId.get(entry.id)
        return { ...entry, deletedAt: null, updatedAt: Math.max(now, entry.updatedAt, (local?.updatedAt ?? 0) + 1) }
      }),
    ]
  }
  const ids = new Set(live.map((entry) => entry.id))
  const keys = new Set(live.map((entry) => keyOf(entry.displayLemma, entry.language)))
  const out: StoredEntry[] = []
  for (const entry of incoming) {
    const key = keyOf(entry.displayLemma, entry.language)
    if (ids.has(entry.id) || keys.has(key)) continue
    ids.add(entry.id)
    keys.add(key)
    const deleted = byId.get(entry.id)
    out.push({
      ...entry,
      deletedAt: null,
      updatedAt: deleted ? Math.max(now, deleted.updatedAt + 1) : entry.updatedAt,
    })
  }
  return out
}

/**
 * When two live records stand for the same word (kept separately on two
 * devices before they synced, or before ids depended on the word), the
 * changes that merge them: the one with the most review history stays and
 * takes the other's note if it has none; the other is deleted. Every device
 * picks the same survivor, so they converge.
 */
export function duplicateFixes(entries: Iterable<StoredEntry>, now = Date.now()): StoredEntry[] {
  const groups = new Map<string, StoredEntry[]>()
  for (const entry of entries) {
    if (entry.deletedAt) continue
    const key = keyOf(entry.displayLemma, entry.language)
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }
  const fixes: StoredEntry[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const [winner, ...losers] = [...group].sort(
      (a, b) =>
        b.repetitions - a.repetitions ||
        (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0) ||
        b.updatedAt - a.updatedAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    if (!winner) continue
    const note = losers.find((entry) => entry.note.trim())?.note
    if (!winner.note.trim() && note) fixes.push(withPatch(winner, { note }, now))
    for (const loser of losers) fixes.push(tombstone(loser, now))
  }
  return fixes
}

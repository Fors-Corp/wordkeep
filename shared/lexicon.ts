import { isContentToken } from './phrase.ts'
import { applyGrade, initialRecall } from './sm2.ts'
import type {
  EntryKind,
  Grade,
  GraphNode,
  GraphPayload,
  LinkRelation,
  LookupResult,
  PhraseAnalysis,
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

export function newId(): string {
  return globalThis.crypto.randomUUID()
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
  const id = options.id ?? newId()
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
  const id = options.id ?? newId()
  const display = analysis.text.trim()
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

/** Read-only view over the device's records: lists, details, review, stats, and the atlas. */
export class Lexicon {
  private readonly active: StoredEntry[]
  private readonly byId = new Map<string, StoredEntry>()
  private readonly byKey = new Map<string, string>()

  constructor(entries: Iterable<StoredEntry>) {
    this.active = [...entries].filter((entry) => !entry.deletedAt)
    for (const entry of this.active) {
      this.byId.set(entry.id, entry)
      const key = keyOf(entry.displayLemma, entry.language)
      if (!this.byKey.has(key)) this.byKey.set(key, entry.id)
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
    for (const other of this.active) {
      if (other.id === entry.id) continue
      for (const link of other.links) {
        if (keyOf(link.lemma, link.language) !== selfKey) continue
        push(
          {
            lemma: other.displayLemma,
            language: other.language,
            languageName: other.languageName,
            relation: link.relation,
          },
          other.id,
        )
      }
    }
    return out.sort((a, b) => a.languageName.localeCompare(b.languageName))
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
      .sort((a, b) => a.displayLemma.localeCompare(b.displayLemma, undefined, { sensitivity: 'base' }))
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

export function isStoredEntry(value: unknown): value is StoredEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as StoredEntry
  return (
    typeof entry.id === 'string' &&
    typeof entry.displayLemma === 'string' &&
    typeof entry.language === 'string' &&
    Array.isArray(entry.senses) &&
    Array.isArray(entry.links)
  )
}

/** Reads a backup file in either format. Throws on anything else. */
export function readBackup(raw: unknown): StoredEntry[] {
  if (raw && typeof raw === 'object') {
    const body = raw as { version?: unknown; entries?: unknown; words?: unknown; senses?: unknown; links?: unknown }
    if (body.version === 2 && Array.isArray(body.entries) && body.entries.every(isStoredEntry)) {
      return body.entries.map((entry) => ({ ...entry, deletedAt: entry.deletedAt ?? null }))
    }
    if (body.version === 1 && Array.isArray(body.words) && Array.isArray(body.senses) && Array.isArray(body.links)) {
      return fromV1(body as { words: V1Row[]; senses: V1Row[]; links: V1Row[] })
    }
  }
  throw new Error('Invalid backup file')
}

/**
 * The records to write for an import. Merge keeps what is already there and
 * adds the rest; replace also deletes (tombstones) everything not in the file.
 */
export function planImport(
  current: StoredEntry[],
  incoming: StoredEntry[],
  mode: 'merge' | 'replace',
  now = Date.now(),
): StoredEntry[] {
  const live = current.filter((entry) => !entry.deletedAt)
  if (mode === 'replace') {
    const keep = new Set(incoming.map((entry) => entry.id))
    return [
      ...live.filter((entry) => !keep.has(entry.id)).map((entry) => tombstone(entry, now)),
      ...incoming.map((entry) => ({ ...entry, deletedAt: null, updatedAt: now })),
    ]
  }
  const ids = new Set(live.map((entry) => entry.id))
  const keys = new Set(live.map((entry) => keyOf(entry.displayLemma, entry.language)))
  return incoming
    .filter((entry) => !ids.has(entry.id) && !keys.has(keyOf(entry.displayLemma, entry.language)))
    .map((entry) => ({ ...entry, deletedAt: null, updatedAt: now }))
}

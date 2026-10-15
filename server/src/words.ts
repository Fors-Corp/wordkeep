import type {
  EntryKind,
  Grade,
  LinkRelation,
  LookupResult,
  PhraseAnalysis,
  Sense,
  Stats,
  WordDetail,
  WordForm,
  WordLink,
  WordSummary,
} from '../../shared/types.ts'
import { applyGrade, initialRecall } from '../../shared/sm2.ts'
import { isContentToken } from '../../shared/phrase.ts'
import { db, findWordId, normalizeLemma } from './db.ts'

export { findWordId, normalizeLemma }

type WordRow = {
  id: string
  kind: string | null
  analysis_json: string | null
  lemma: string
  display_lemma: string
  language: string
  language_name: string
  phonetic: string | null
  etymology: string | null
  note: string
  primary_sense_id: string | null
  archived_at: number | null
  status: WordDetail['status']
  ease_factor: number
  interval_days: number
  repetitions: number
  due_at: number
  last_reviewed_at: number | null
  created_at: number
  updated_at: number
  forms_json: string | null
}

function parseList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function glossFor(wordId: string, primarySenseId: string | null): string {
  if (primarySenseId) {
    const primary = db
      .prepare('SELECT definition FROM senses WHERE id = ?')
      .get(primarySenseId) as { definition: string } | undefined
    if (primary) return primary.definition
  }
  const first = db
    .prepare('SELECT definition FROM senses WHERE word_id = ? ORDER BY sort_order ASC LIMIT 1')
    .get(wordId) as { definition: string } | undefined
  return first?.definition ?? ''
}

function toSummary(row: WordRow): WordSummary {
  return {
    id: row.id,
    kind: row.kind === 'phrase' ? 'phrase' : 'word',
    lemma: row.lemma,
    displayLemma: row.display_lemma,
    language: row.language,
    languageName: row.language_name,
    phonetic: row.phonetic,
    gloss: glossFor(row.id, row.primary_sense_id),
    status: row.status,
    dueAt: row.due_at,
    archivedAt: row.archived_at,
    lastReviewedAt: row.last_reviewed_at,
    createdAt: row.created_at,
  }
}

function sensesFor(wordId: string): Sense[] {
  const rows = db
    .prepare(
      `SELECT id, part_of_speech, definition, synonyms_json, antonyms_json, tags_json, examples_json, sort_order
       FROM senses WHERE word_id = ? ORDER BY sort_order ASC`,
    )
    .all(wordId) as Array<{
    id: string
    part_of_speech: string | null
    definition: string
    synonyms_json: string | null
    antonyms_json: string | null
    tags_json: string | null
    examples_json: string | null
    sort_order: number
  }>
  return rows.map((row) => ({
    id: row.id,
    partOfSpeech: row.part_of_speech ?? '',
    definition: row.definition,
    examples: parseList(row.examples_json),
    synonyms: parseList(row.synonyms_json),
    antonyms: parseList(row.antonyms_json),
    tags: parseList(row.tags_json),
    sortOrder: row.sort_order,
  }))
}

function formsFor(row: WordRow): WordForm[] {
  if (!row.forms_json) return []
  try {
    const value = JSON.parse(row.forms_json) as WordForm[]
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function analysisFor(row: WordRow): PhraseAnalysis | null {
  if (row.kind !== 'phrase' || !row.analysis_json) return null
  try {
    const value = JSON.parse(row.analysis_json) as PhraseAnalysis
    return value && Array.isArray(value.tokens) ? { ...value, existing: { id: row.id } } : null
  } catch {
    return null
  }
}

function linksFor(wordId: string): WordLink[] {
  const rows = db
    .prepare(
      'SELECT id, to_lemma, to_language, to_language_name, to_word_id, relation FROM word_links WHERE from_word_id = ? ORDER BY to_language_name ASC',
    )
    .all(wordId) as Array<{
    id: string
    to_lemma: string
    to_language: string
    to_language_name: string
    to_word_id: string | null
    relation: LinkRelation
  }>
  return rows.map((row) => ({
    id: row.id,
    lemma: row.to_lemma,
    language: row.to_language,
    languageName: row.to_language_name,
    toWordId: row.to_word_id,
    relation: row.relation,
  }))
}

export function upsertLink(input: {
  fromId: string
  toLemma: string
  toLanguage: string
  toLanguageName: string
  relation: LinkRelation
  toWordId?: string | null
  fromLemma?: string
  fromLanguage?: string
  fromLanguageName?: string
}) {
  const toLemma = normalizeLemma(input.toLemma, input.toLanguage)
  const existing = input.toWordId ?? findWordId(input.toLemma, input.toLanguage)
  db.prepare(
    `INSERT OR IGNORE INTO word_links (id, from_word_id, to_lemma, to_language, to_language_name, to_word_id, relation)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.fromId,
    toLemma,
    input.toLanguage,
    input.toLanguageName,
    existing,
    input.relation,
  )
  if (existing && input.fromLemma && input.fromLanguage) {
    db.prepare(
      `INSERT OR IGNORE INTO word_links (id, from_word_id, to_lemma, to_language, to_language_name, to_word_id, relation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      existing,
      normalizeLemma(input.fromLemma, input.fromLanguage),
      input.fromLanguage,
      input.fromLanguageName ?? input.fromLanguage,
      input.fromId,
      input.relation,
    )
    db.prepare(
      `UPDATE word_links SET to_word_id = ? WHERE from_word_id = ? AND to_lemma = ? AND to_language = ? AND relation = ?`,
    ).run(input.fromId, existing, normalizeLemma(input.fromLemma, input.fromLanguage), input.fromLanguage, input.relation)
  }
}

function toDetail(row: WordRow): WordDetail {
  return {
    ...toSummary(row),
    etymology: row.etymology,
    note: row.note,
    primarySenseId: row.primary_sense_id,
    easeFactor: row.ease_factor,
    intervalDays: row.interval_days,
    repetitions: row.repetitions,
    updatedAt: row.updated_at,
    forms: formsFor(row),
    senses: sensesFor(row.id),
    links: linksFor(row.id),
    analysis: analysisFor(row),
  }
}

export function getWord(id: string): WordDetail | null {
  const row = db.prepare('SELECT * FROM words WHERE id = ?').get(id) as WordRow | undefined
  return row ? toDetail(row) : null
}

export function listWords(opts: {
  q?: string
  status?: string
  due?: string
  language?: string
  kind?: string
  archived?: boolean
}): WordSummary[] {
  const clauses: string[] = []
  const params: Array<string | number> = []

  if (opts.archived) clauses.push('archived_at IS NOT NULL')
  else if (opts.status !== 'archived') clauses.push('archived_at IS NULL')

  if (opts.status && opts.status !== 'all' && opts.status !== 'archived') {
    clauses.push('status = ?')
    params.push(opts.status)
  }
  if (opts.due === 'today') {
    clauses.push('due_at <= ? AND archived_at IS NULL')
    params.push(Date.now())
  }
  if (opts.language) {
    clauses.push('language = ?')
    params.push(opts.language)
  }
  if (opts.kind === 'word' || opts.kind === 'phrase') {
    clauses.push('kind = ?')
    params.push(opts.kind)
  }
  if (opts.q) {
    clauses.push('(display_lemma LIKE ? OR lemma LIKE ? OR note LIKE ?)')
    const like = `%${opts.q}%`
    params.push(like, like, like)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM words ${where} ORDER BY display_lemma COLLATE NOCASE ASC`)
    .all(...params) as WordRow[]
  return rows.map(toSummary)
}

export function insertFromLookup(
  lookup: LookupResult,
  note: string,
  primarySenseIndex: number,
): WordDetail {
  const now = Date.now()
  const recall = initialRecall(now)
  const id = crypto.randomUUID()
  const lemma = lookup.lemma || normalizeLemma(lookup.displayLemma, lookup.language)

  db.prepare(
    `INSERT INTO words (
      id, lemma, display_lemma, language, language_name, phonetic, etymology, note, forms_json,
      status, ease_factor, interval_days, repetitions, due_at, last_reviewed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    lemma,
    lookup.displayLemma.trim(),
    lookup.language,
    lookup.languageName,
    lookup.phonetic,
    lookup.etymology,
    note,
    JSON.stringify(lookup.forms ?? []),
    recall.status,
    recall.easeFactor,
    recall.intervalDays,
    recall.repetitions,
    recall.dueAt,
    recall.lastReviewedAt,
    now,
    now,
  )

  const senseIds: string[] = []
  const insertSense = db.prepare(
    `INSERT INTO senses (id, word_id, part_of_speech, definition, synonyms_json, antonyms_json, tags_json, examples_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  lookup.senses.forEach((sense, index) => {
    const senseId = crypto.randomUUID()
    senseIds.push(senseId)
    insertSense.run(
      senseId,
      id,
      sense.partOfSpeech,
      sense.definition,
      JSON.stringify(sense.synonyms ?? []),
      JSON.stringify(sense.antonyms ?? []),
      JSON.stringify(sense.tags ?? []),
      JSON.stringify(sense.examples ?? []),
      index,
    )
  })

  const primary = senseIds[primarySenseIndex] ?? senseIds[0] ?? null
  if (primary) {
    db.prepare('UPDATE words SET primary_sense_id = ? WHERE id = ?').run(primary, id)
  }

  for (const translation of lookup.translations.slice(0, 40)) {
    if (!translation.lemma.trim()) continue
    upsertLink({
      fromId: id,
      toLemma: translation.lemma,
      toLanguage: translation.language,
      toLanguageName: translation.languageName,
      relation: 'translation',
      fromLemma: lookup.displayLemma,
      fromLanguage: lookup.language,
      fromLanguageName: lookup.languageName,
    })
  }

  const syns = new Set<string>()
  const ants = new Set<string>()
  for (const sense of lookup.senses) {
    for (const term of sense.synonyms ?? []) syns.add(term)
    for (const term of sense.antonyms ?? []) ants.add(term)
  }
  for (const term of [...syns].slice(0, 12)) {
    upsertLink({
      fromId: id,
      toLemma: term,
      toLanguage: lookup.language,
      toLanguageName: lookup.languageName,
      relation: 'synonym',
      fromLemma: lookup.displayLemma,
      fromLanguage: lookup.language,
      fromLanguageName: lookup.languageName,
    })
  }
  linkWaitingPhrases(id, lemma, lookup.language, lookup.displayLemma, lookup.languageName)

  for (const term of [...ants].slice(0, 12)) {
    upsertLink({
      fromId: id,
      toLemma: term,
      toLanguage: lookup.language,
      toLanguageName: lookup.languageName,
      relation: 'antonym',
      fromLemma: lookup.displayLemma,
      fromLanguage: lookup.language,
      fromLanguageName: lookup.languageName,
    })
  }

  return getWord(id)!
}

/** Kept phrases that contain this word now point at it, and it points back. */
function linkWaitingPhrases(id: string, lemma: string, language: string, display: string, languageName: string) {
  db.prepare(
    `UPDATE word_links SET to_word_id = ?
     WHERE relation = 'phrase' AND to_word_id IS NULL AND to_lemma = ? AND to_language = ?`,
  ).run(id, lemma, language)
  const phrases = db
    .prepare(
      `SELECT w.id, w.display_lemma, w.language, w.language_name FROM word_links l
       JOIN words w ON w.id = l.from_word_id
       WHERE l.relation = 'phrase' AND l.to_word_id = ? AND w.kind = 'phrase'`,
    )
    .all(id) as Array<{ id: string; display_lemma: string; language: string; language_name: string }>
  for (const phrase of phrases) {
    upsertLink({
      fromId: id,
      toLemma: phrase.display_lemma,
      toLanguage: phrase.language,
      toLanguageName: phrase.language_name,
      relation: 'phrase',
      toWordId: phrase.id,
      fromLemma: display,
      fromLanguage: language,
      fromLanguageName: languageName,
    })
  }
}

function phraseSense(analysis: PhraseAnalysis, gloss: string) {
  const tags = [analysis.sentenceType, analysis.tense, analysis.mood, analysis.voice]
    .map((item) => item.trim())
    .filter(Boolean)
  const examples = analysis.idioms.map((item) => `${item.text} — ${item.meaning}`).slice(0, 4)
  return { definition: gloss, tags, examples }
}

function storedAnalysis(analysis: PhraseAnalysis): string {
  return JSON.stringify({ ...analysis, existing: null })
}

export function insertPhrase(analysis: PhraseAnalysis, gloss: string, note: string): WordDetail {
  const now = Date.now()
  const recall = initialRecall(now)
  const id = crypto.randomUUID()
  const display = analysis.text.trim()
  const lemma = normalizeLemma(display, analysis.language)

  db.prepare(
    `INSERT INTO words (
      id, kind, analysis_json, lemma, display_lemma, language, language_name, phonetic, etymology, note, forms_json,
      status, ease_factor, interval_days, repetitions, due_at, last_reviewed_at, created_at, updated_at
    ) VALUES (?, 'phrase', ?, ?, ?, ?, ?, NULL, NULL, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    storedAnalysis(analysis),
    lemma,
    display,
    analysis.language,
    analysis.languageName,
    note,
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
  const sense = phraseSense(analysis, gloss)
  db.prepare(
    `INSERT INTO senses (id, word_id, part_of_speech, definition, synonyms_json, antonyms_json, tags_json, examples_json, sort_order)
     VALUES (?, ?, 'phrase', ?, '[]', '[]', ?, ?, 0)`,
  ).run(senseId, id, sense.definition, JSON.stringify(sense.tags), JSON.stringify(sense.examples))
  db.prepare('UPDATE words SET primary_sense_id = ? WHERE id = ?').run(senseId, id)

  const seen = new Set<string>()
  for (const token of analysis.tokens) {
    const trusted = token.known || (analysis.source === 'claude' && token.partOfSpeech)
    if (!trusted || !isContentToken(token)) continue
    const key = normalizeLemma(token.lemma, analysis.language)
    if (!key || key === lemma || seen.has(key)) continue
    seen.add(key)
    upsertLink({
      fromId: id,
      toLemma: token.lemma,
      toLanguage: analysis.language,
      toLanguageName: analysis.languageName,
      relation: 'phrase',
      fromLemma: display,
      fromLanguage: analysis.language,
      fromLanguageName: analysis.languageName,
    })
    if (seen.size >= 12) break
  }

  return getWord(id)!
}

export function updatePhraseAnalysis(id: string, analysis: PhraseAnalysis, gloss: string): WordDetail | null {
  const row = db.prepare('SELECT * FROM words WHERE id = ?').get(id) as WordRow | undefined
  if (!row || row.kind !== 'phrase') return null
  const sense = phraseSense(analysis, gloss)
  db.prepare('UPDATE words SET analysis_json = ?, updated_at = ? WHERE id = ?').run(
    storedAnalysis(analysis),
    Date.now(),
    id,
  )
  db.prepare(
    `UPDATE senses SET definition = ?, tags_json = ?, examples_json = ? WHERE word_id = ? AND part_of_speech = 'phrase'`,
  ).run(sense.definition, JSON.stringify(sense.tags), JSON.stringify(sense.examples), id)
  return getWord(id)
}

export function wordKind(id: string): EntryKind | null {
  const row = db.prepare('SELECT kind FROM words WHERE id = ?').get(id) as { kind: string } | undefined
  if (!row) return null
  return row.kind === 'phrase' ? 'phrase' : 'word'
}

export function updateWord(
  id: string,
  patch: {
    note?: string
    primarySenseId?: string
    etymology?: string
    archived?: boolean
  },
): WordDetail | null {
  const current = db.prepare('SELECT * FROM words WHERE id = ?').get(id) as WordRow | undefined
  if (!current) return null
  const archivedAt =
    patch.archived === undefined ? current.archived_at : patch.archived ? Date.now() : null
  db.prepare(
    `UPDATE words SET note = ?, primary_sense_id = ?, etymology = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.note ?? current.note,
    patch.primarySenseId ?? current.primary_sense_id,
    patch.etymology ?? current.etymology,
    archivedAt,
    Date.now(),
    id,
  )
  return getWord(id)
}

export function deleteWord(id: string): boolean {
  return Number(db.prepare('DELETE FROM words WHERE id = ?').run(id).changes) > 0
}

export function reviewQueue(): WordDetail[] {
  const rows = db
    .prepare(
      `SELECT * FROM words WHERE archived_at IS NULL AND due_at <= ? ORDER BY due_at ASC, created_at ASC`,
    )
    .all(Date.now()) as WordRow[]
  return rows.map(toDetail)
}

export function gradeWord(id: string, grade: Grade): WordDetail | null {
  const row = db.prepare('SELECT * FROM words WHERE id = ?').get(id) as WordRow | undefined
  if (!row || row.archived_at) return null
  const next = applyGrade(
    {
      easeFactor: row.ease_factor,
      intervalDays: row.interval_days,
      repetitions: row.repetitions,
      dueAt: row.due_at,
      lastReviewedAt: row.last_reviewed_at,
      status: row.status,
    },
    grade,
  )
  db.prepare(
    `UPDATE words SET
      ease_factor = ?, interval_days = ?, repetitions = ?, due_at = ?,
      last_reviewed_at = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.easeFactor,
    next.intervalDays,
    next.repetitions,
    next.dueAt,
    next.lastReviewedAt,
    next.status,
    Date.now(),
    id,
  )
  return getWord(id)
}

export function stats(): Stats {
  const now = Date.now()
  const lexiconCount = (
    db.prepare('SELECT COUNT(*) AS n FROM words WHERE archived_at IS NULL').get() as { n: number }
  ).n
  const dueToday = (
    db
      .prepare('SELECT COUNT(*) AS n FROM words WHERE archived_at IS NULL AND due_at <= ?')
      .get(now) as { n: number }
  ).n
  const newCount = (
    db
      .prepare('SELECT COUNT(*) AS n FROM words WHERE archived_at IS NULL AND status = ?')
      .get('new') as { n: number }
  ).n
  const languageCount = (
    db
      .prepare('SELECT COUNT(DISTINCT language) AS n FROM words WHERE archived_at IS NULL')
      .get() as { n: number }
  ).n
  const phraseCount = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM words WHERE archived_at IS NULL AND kind = 'phrase'`)
      .get() as { n: number }
  ).n
  return { dueToday, newCount, lexiconCount, languageCount, phraseCount }
}

export function recentWords(limit = 6): WordSummary[] {
  const rows = db
    .prepare('SELECT * FROM words WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT ?')
    .all(limit) as WordRow[]
  return rows.map(toSummary)
}

export function allActiveWordRows(): WordRow[] {
  return db.prepare('SELECT * FROM words WHERE archived_at IS NULL').all() as WordRow[]
}

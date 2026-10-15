import type { GrammarQuestion, PhraseAnalysis, PhraseIdiom, PhraseToken } from '../../shared/types.ts'
import {
  MAX_PHRASE_CHARS,
  MAX_PHRASE_WORDS,
  isContentToken,
  normalizePhrase,
  segmentPhrase,
} from '../../shared/phrase.ts'
import { findWordId, normalizeLemma } from './db.ts'
import { analyzeGrammar, grammarAnalyzerActive, type ClaudeGrammar } from './grammar-ai.ts'
import { languageName } from './languages.ts'
import { fetchFreeDictionary, type FreeEntry } from './lookup.ts'

type TokenInfo = {
  lemma: string
  partOfSpeech: string
  features: string[]
  gloss: string
  known: boolean
  /** The lookup failed (network, rate limit) rather than finding nothing. */
  failed?: boolean
}

const UNKNOWN: TokenInfo = { lemma: '', partOfSpeech: '', features: [], gloss: '', known: false }
const MAX_TOKEN_CACHE = 2000
const MAX_ANALYSIS_CACHE = 200
const LOOKUP_CONCURRENCY = 4

const tokenCache = new Map<string, Promise<TokenInfo>>()
const analysisCache = new Map<string, PhraseAnalysis>()

export class PhraseInputError extends Error {}

export function clearPhraseCache() {
  tokenCache.clear()
  analysisCache.clear()
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, cap: number) {
  if (map.size >= cap) {
    const first = map.keys().next().value
    if (first !== undefined) map.delete(first)
  }
  map.set(key, value)
}

const FORM_OF =
  /^(.*\b(?:plural|singular|past|present|participle|gerund|comparative|superlative|tense|person|form|inflection|feminine|masculine|neuter|nominative|accusative|genitive|dative|ablative|locative|instrumental|vocative|imperative|subjunctive|indicative|infinitive|conditional|future|imperfect|preterite|perfect|diminutive|augmentative|contraction|spelling)\b[^:;]*?)\s+of\s+["“]?([^"”;:()]+?)["”]?\s*(?:[;:(.].*)?$/i

/** Reads “simple past of go” style definitions into features and a lemma. */
export function parseFormOf(definition: string): { features: string; lemma: string } | null {
  const match = FORM_OF.exec(definition.trim())
  if (!match) return null
  const features = match[1]!.trim().toLowerCase()
  const lemma = match[2]!.trim()
  if (!lemma || lemma.split(/\s+/).length > 3) return null
  return { features, lemma }
}

function entriesFor(entries: FreeEntry[] | undefined, lang: string): FreeEntry[] {
  const all = entries ?? []
  const own = all.filter((entry) => !entry.language?.code || entry.language.code === lang)
  return own.length ? own : all
}

function firstDefinition(entries: FreeEntry[], skipFormOf: boolean): string {
  for (const entry of entries) {
    for (const sense of entry.senses ?? []) {
      const definition = sense.definition?.trim()
      if (!definition) continue
      if (skipFormOf && parseFormOf(definition)) continue
      return definition
    }
  }
  return ''
}

async function fetchEntries(word: string, lang: string): Promise<FreeEntry[]> {
  const payload = await fetchFreeDictionary(word, lang)
  return entriesFor(payload?.entries, lang)
}

async function fetchEntriesQuietly(word: string, lang: string): Promise<FreeEntry[]> {
  try {
    return await fetchEntries(word, lang)
  } catch {
    return []
  }
}

async function infoFor(word: string, lang: string, depth = 0): Promise<TokenInfo> {
  const lower = normalizeLemma(word, lang)
  let entries = await fetchEntries(lower, lang)
  if (!entries.length && lower !== word) entries = await fetchEntries(word, lang)
  if (!entries.length) return UNKNOWN

  const first = entries[0]!
  const partOfSpeech = (first.partOfSpeech ?? '').trim().toLowerCase()
  for (const sense of first.senses ?? []) {
    const parsed = sense.definition ? parseFormOf(sense.definition) : null
    if (!parsed) continue
    const base = depth === 0 ? await cachedInfo(parsed.lemma, lang, depth + 1) : UNKNOWN
    return {
      lemma: parsed.lemma,
      partOfSpeech,
      features: [parsed.features],
      gloss: base.gloss || sense.definition!.trim(),
      known: true,
    }
  }
  return {
    lemma: lower,
    partOfSpeech,
    features: [],
    gloss: firstDefinition(entries, true) || firstDefinition(entries, false),
    known: true,
  }
}

function cachedInfo(word: string, lang: string, depth = 0): Promise<TokenInfo> {
  const key = `${lang}:${word}`
  const hit = tokenCache.get(key)
  if (hit) return hit
  const pending = infoFor(word, lang, depth).catch((): TokenInfo => {
    tokenCache.delete(key)
    return { ...UNKNOWN, failed: true }
  })
  remember(tokenCache, key, pending, MAX_TOKEN_CACHE)
  return pending
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function dictionaryQuestions(tokens: PhraseToken[]): GrammarQuestion[] {
  const questions: GrammarQuestion[] = []
  const inflected = tokens.filter((token) => token.known && token.features.length)
  const content = tokens.filter((token) => token.known && token.partOfSpeech && isContentToken(token))
  for (const token of [...inflected, ...content]) {
    if (questions.some((item) => item.question.includes(`“${token.text}”`))) continue
    if (token.features.length) {
      questions.push({
        question: `Which form of “${token.lemma}” is “${token.text}”?`,
        answer: `${token.features.join(', ')} (${token.partOfSpeech || 'word'})`,
      })
    } else {
      questions.push({
        question: `What part of speech is “${token.text}” here?`,
        answer: token.partOfSpeech,
      })
    }
    if (questions.length >= 3) break
  }
  return questions
}

function mergeClaude(base: PhraseAnalysis, ai: ClaudeGrammar): PhraseAnalysis {
  const byIndex = new Map(ai.tokens.map((token) => [token.index, token]))
  const tokens = base.tokens.map((token) => {
    const hit = token.punct ? undefined : byIndex.get(token.index)
    if (!hit) return token
    return {
      ...token,
      lemma: hit.lemma.trim() || token.lemma,
      partOfSpeech: hit.partOfSpeech.trim().toLowerCase() || token.partOfSpeech,
      role: hit.role.trim(),
      features: hit.features.map((item) => item.trim()).filter(Boolean),
      explanation: hit.explanation.trim(),
    }
  })
  const valid = new Set(tokens.filter((token) => !token.punct).map((token) => token.index))
  const idioms = [...ai.idioms, ...base.idioms].filter(
    (item, index, list) =>
      item.text.trim() &&
      list.findIndex((other) => other.text.toLowerCase() === item.text.toLowerCase()) === index,
  )
  return {
    ...base,
    source: 'claude',
    translation: ai.translation.trim(),
    summary: ai.summary.trim(),
    sentenceType: ai.sentenceType.trim(),
    tense: ai.tense.trim(),
    mood: ai.mood.trim(),
    voice: ai.voice.trim(),
    clauses: ai.clauses.filter((item) => item.text.trim()),
    idioms,
    tokens,
    questions: ai.questions.filter((item) => item.question.trim() && item.answer.trim()).slice(0, 6),
    clozeIndexes: ai.clozeIndexes.filter((index) => valid.has(index)).slice(0, 4),
    note: null,
  }
}

export function phraseLemma(text: string, lang: string): string {
  return normalizeLemma(normalizePhrase(text), lang)
}

function withExisting(analysis: PhraseAnalysis): PhraseAnalysis {
  const id = findWordId(phraseLemma(analysis.text, analysis.language), analysis.language)
  return { ...analysis, existing: id ? { id } : null }
}

/**
 * Breaks a phrase into words with a dictionary lookup for each, then asks
 * Claude for structure, translation, and quiz material when a key is set.
 */
export async function analyzePhrase(rawText: string, lang: string, explain = 'en'): Promise<PhraseAnalysis> {
  const text = normalizePhrase(rawText)
  if (!text) throw new PhraseInputError('Type a phrase to analyze')
  if (text.length > MAX_PHRASE_CHARS) {
    throw new PhraseInputError(`Phrases can be up to ${MAX_PHRASE_CHARS} characters`)
  }
  const segments = segmentPhrase(text, lang)
  const words = segments.filter((part) => part.wordLike)
  if (!words.length) throw new PhraseInputError('Type a phrase to analyze')
  if (words.length > MAX_PHRASE_WORDS) {
    throw new PhraseInputError(`Phrases can be up to ${MAX_PHRASE_WORDS} words`)
  }

  const aiActive = grammarAnalyzerActive()
  const cacheKey = `${lang}|${explain}|${aiActive ? 'ai' : 'dict'}|${text}`
  const cached = analysisCache.get(cacheKey)
  if (cached) return withExisting(cached)

  const unique = [...new Set(words.map((part) => part.text))]
  const [infos, whole] = await Promise.all([
    mapLimit(unique, LOOKUP_CONCURRENCY, (word) => cachedInfo(word, lang)),
    words.length > 1 ? fetchEntriesQuietly(text, lang) : Promise.resolve([]),
  ])
  const infoByWord = new Map(unique.map((word, index) => [word, infos[index] ?? UNKNOWN]))

  const tokens: PhraseToken[] = segments.map((part, index) => {
    if (!part.wordLike) {
      return {
        index,
        start: part.start,
        text: part.text,
        lemma: part.text,
        partOfSpeech: 'punctuation',
        features: [],
        role: '',
        gloss: '',
        explanation: '',
        known: false,
        punct: true,
      }
    }
    const info = infoByWord.get(part.text) ?? UNKNOWN
    return {
      index,
      start: part.start,
      text: part.text,
      lemma: info.lemma || normalizeLemma(part.text, lang),
      partOfSpeech: info.partOfSpeech,
      features: info.features,
      role: '',
      gloss: info.gloss,
      explanation: '',
      known: info.known,
      punct: false,
    }
  })

  const idioms: PhraseIdiom[] = []
  const wholeMeaning = firstDefinition(whole, false)
  if (wholeMeaning) idioms.push({ text, meaning: wholeMeaning })

  let analysis: PhraseAnalysis = {
    text,
    language: lang,
    languageName: languageName(lang),
    source: 'dictionary',
    translation: '',
    summary: '',
    sentenceType: '',
    tense: '',
    mood: '',
    voice: '',
    clauses: [],
    idioms,
    tokens,
    questions: dictionaryQuestions(tokens),
    clozeIndexes: tokens.filter((token) => token.known && isContentToken(token)).map((token) => token.index).slice(0, 4),
    note: aiActive
      ? null
      : 'Word-by-word dictionary breakdown. Set ANTHROPIC_API_KEY on the server for sentence structure, tense, idioms, and a translation.',
    existing: null,
  }

  if (aiActive) {
    try {
      const ai = await analyzeGrammar({
        text,
        languageName: analysis.languageName,
        explainIn: languageName(explain),
        tokens: tokens
          .filter((token) => !token.punct)
          .map(({ index, text: surface, lemma, partOfSpeech, features, gloss }) => ({
            index,
            text: surface,
            lemma,
            partOfSpeech,
            features,
            gloss,
          })),
      })
      analysis = mergeClaude(analysis, ai)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      return withExisting({
        ...analysis,
        note: `Claude analysis unavailable (${message}). Showing the dictionary breakdown.`,
      })
    }
  }

  if (!infos.some((info) => info.failed)) remember(analysisCache, cacheKey, analysis, MAX_ANALYSIS_CACHE)
  return withExisting(analysis)
}

/** One-line meaning used as the lexicon gloss and the review answer. */
export function phraseGloss(analysis: PhraseAnalysis): string {
  if (analysis.translation) return analysis.translation
  if (analysis.idioms[0]?.meaning) return analysis.idioms[0].meaning
  if (analysis.summary) return analysis.summary
  const parts = analysis.tokens
    .filter((token) => !token.punct && token.gloss)
    .map((token) => `${token.text}: ${token.gloss.replace(/\.$/, '')}`)
  return parts.join(' · ').slice(0, 400) || analysis.text
}

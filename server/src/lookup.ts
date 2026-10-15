import type { LookupResult, SenseDraft, TranslationDraft, WordForm } from '../../shared/types.ts'
import { normalizeLemma } from './db.ts'
import { fetchWikiExtras } from './etymology.ts'
import { languageName } from './languages.ts'
import { fetchNativeWiki } from './native-defs.ts'
import { detectLanguages, suggestWords } from './suggest.ts'

export type FreeSense = {
  definition?: string
  examples?: string[]
  synonyms?: string[]
  antonyms?: string[]
  tags?: string[]
  translations?: Array<{ language?: { code?: string; name?: string }; word?: string }>
}

export type FreeEntry = {
  language?: { code?: string; name?: string }
  partOfSpeech?: string
  pronunciations?: Array<{ type?: string; text?: string }>
  forms?: Array<{ word?: string; tags?: string[] }>
  synonyms?: string[]
  antonyms?: string[]
  senses?: FreeSense[]
}

export type FreeResponse = {
  word?: string
  entries?: FreeEntry[]
}

const lookupCache = new Map<string, LookupResult>()
const MAX_CACHE = 200
const MAX_TRANSLATIONS = 160

export function clearLookupCache() {
  lookupCache.clear()
}

function cacheSet(key: string, value: LookupResult) {
  if (lookupCache.size >= MAX_CACHE) {
    const first = lookupCache.keys().next().value
    if (first) lookupCache.delete(first)
  }
  lookupCache.set(key, value)
}

function firstIpa(entries: FreeEntry[]): string | null {
  for (const entry of entries) {
    const ipa = entry.pronunciations?.find((item) => item.type === 'ipa' && item.text)
    if (ipa?.text) return ipa.text
    const any = entry.pronunciations?.find((item) => item.text)
    if (any?.text) return any.text
  }
  return null
}

function cleanTerms(terms: string[], self: string, limit = 14): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const selfKey = self.trim().toLowerCase()
  for (const raw of terms) {
    const term = raw.trim()
    if (!term || term.length > 42) continue
    const key = term.toLowerCase()
    if (key === selfKey || seen.has(key)) continue
    seen.add(key)
    out.push(term)
    if (out.length >= limit) break
  }
  return out
}

function pickTerms(primary: string[], fallbacks: string[][], self: string): string[] {
  const first = cleanTerms(primary, self)
  if (first.length) return first
  for (const extra of fallbacks) {
    const next = cleanTerms(extra, self)
    if (next.length) return next
  }
  return []
}

function collectForms(entries: FreeEntry[]): WordForm[] {
  const seen = new Set<string>()
  const forms: WordForm[] = []
  for (const entry of entries) {
    for (const form of entry.forms ?? []) {
      const word = form.word?.trim()
      if (!word) continue
      const key = word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      forms.push({ word, tags: (form.tags ?? []).filter(Boolean).slice(0, 4) })
      if (forms.length >= 10) return forms
    }
  }
  return forms
}

function attachTerms(senses: SenseDraft[], donors: SenseDraft[]): SenseDraft[] {
  if (!senses.length) return senses
  const byPos = new Map(donors.map((sense) => [sense.partOfSpeech.toLowerCase(), sense]))
  return senses.map((sense) => {
    const donor = byPos.get(sense.partOfSpeech.toLowerCase()) ?? donors[0]
    if (!donor) return sense
    return {
      ...sense,
      synonyms: sense.synonyms.length ? sense.synonyms : donor.synonyms,
      antonyms: sense.antonyms.length ? sense.antonyms : donor.antonyms,
      tags: sense.tags.length ? sense.tags : donor.tags,
      examples: sense.examples.length ? sense.examples : donor.examples,
    }
  })
}

function collectSenses(
  entries: FreeEntry[],
  lemma: string,
  wiki: { synonyms: string[]; antonyms: string[] },
): SenseDraft[] {
  const senses: SenseDraft[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const entrySyn = entry.synonyms ?? []
    const entryAnt = entry.antonyms ?? []
    for (const sense of entry.senses ?? []) {
      const definition = sense.definition?.trim()
      if (!definition) continue
      const key = `${entry.partOfSpeech ?? ''}:${definition}`
      if (seen.has(key)) continue
      seen.add(key)
      const examples = (sense.examples ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 4)
      senses.push({
        partOfSpeech: entry.partOfSpeech?.trim() ?? '',
        definition,
        examples,
        synonyms: pickTerms(sense.synonyms ?? [], [entrySyn, wiki.synonyms], lemma),
        antonyms: pickTerms(sense.antonyms ?? [], [entryAnt, wiki.antonyms], lemma),
        tags: (sense.tags ?? []).filter(Boolean).slice(0, 6),
      })
    }
  }
  return senses.slice(0, 40)
}

function mergeTranslations(
  primary: TranslationDraft[],
  extra: TranslationDraft[],
): TranslationDraft[] {
  const byLanguage = new Map<string, TranslationDraft>()
  for (const item of [...primary, ...extra]) {
    if (!item.language || !item.lemma || byLanguage.has(item.language)) continue
    byLanguage.set(item.language, item)
  }
  return [...byLanguage.values()].slice(0, MAX_TRANSLATIONS)
}

function collectTranslations(entries: FreeEntry[], originLang: string): TranslationDraft[] {
  const byLanguage = new Map<string, TranslationDraft>()
  for (const entry of entries) {
    for (const sense of entry.senses ?? []) {
      for (const item of sense.translations ?? []) {
        const language = item.language?.code?.trim()
        const lemma = item.word?.trim()
        if (!language || !lemma || language === originLang) continue
        if (byLanguage.has(language)) continue
        byLanguage.set(language, {
          lemma,
          language,
          languageName: item.language?.name?.trim() || language,
        })
        if (byLanguage.size >= MAX_TRANSLATIONS) return [...byLanguage.values()]
      }
    }
  }
  return [...byLanguage.values()]
}

export async function fetchFreeDictionary(word: string, lang: string): Promise<FreeResponse | null> {
  const url = `https://freedictionaryapi.com/api/v1/entries/${encodeURIComponent(lang)}/${encodeURIComponent(word)}?translations=true`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Wordkeep/1.0' },
    signal: AbortSignal.timeout(12000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Dictionary lookup failed (${res.status})`)
  return (await res.json()) as FreeResponse
}

async function lookupOnce(rawWord: string, lang: string): Promise<LookupResult | null> {
  const displayLemma = rawWord.trim()
  if (!displayLemma) return null
  const lemma = normalizeLemma(displayLemma, lang)
  const cacheKey = `${lang}:${lemma}`
  const cached = lookupCache.get(cacheKey)
  if (cached) {
    return { ...cached, existing: null }
  }

  const guessedName = languageName(lang)
  const [payload, wiki, native] = await Promise.all([
    fetchFreeDictionary(displayLemma, lang),
    fetchWikiExtras(displayLemma, guessedName, lang),
    fetchNativeWiki(displayLemma, lang),
  ])

  const entries = (payload?.entries ?? []).filter((entry) => {
    const code = entry.language?.code
    return !code || code === lang || lang === 'mul'
  })
  const usable = entries.length ? entries : (payload?.entries ?? [])
  const glossary = collectSenses(usable, lemma, wiki)
  const senses = native.senses.length ? attachTerms(native.senses, glossary) : glossary
  if (!senses.length) return null

  const langName = usable[0]?.language?.name || guessedName
  const result: LookupResult = {
    lemma,
    displayLemma: payload?.word?.trim() || displayLemma,
    language: lang,
    languageName: langName,
    phonetic: firstIpa(usable),
    etymology: native.etymology ?? wiki.etymology,
    fallbackFrom: null,
    forms: collectForms(usable),
    senses,
    translations: mergeTranslations(collectTranslations(usable, lang), wiki.translations),
    existing: null,
  }

  cacheSet(cacheKey, result)
  return result
}

export async function lookupWord(rawWord: string, lang: string): Promise<LookupResult | null> {
  const tried = new Set<string>()
  async function attempt(code: string): Promise<LookupResult | null> {
    if (!code || tried.has(code)) return null
    tried.add(code)
    return lookupOnce(rawWord, code)
  }

  const primary = await attempt(lang)
  if (primary) return primary

  const extras: string[] = []
  const add = (code: string) => {
    const clean = (code.split('-')[0] ?? code).toLowerCase()
    if (clean && !tried.has(clean) && !extras.includes(clean)) extras.push(clean)
  }
  for (const code of detectLanguages(rawWord)) add(code)
  try {
    const hints = await suggestWords(rawWord, [lang, ...extras])
    for (const item of hints.suggestions) {
      if (item.exact) add(item.language)
    }
    for (const item of hints.suggestions) add(item.language)
  } catch {
    /* suggestions are a hint, not required */
  }

  for (const code of extras.slice(0, 5)) {
    const hit = await attempt(code)
    if (hit) return { ...hit, fallbackFrom: lang === hit.language ? null : lang }
  }
  return null
}

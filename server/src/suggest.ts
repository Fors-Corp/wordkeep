import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SuggestResponse, Suggestion } from '../../shared/types.ts'
import { languageName } from './languages.ts'
import { isLangCode } from './params.ts'
import { writableDir } from './paths.ts'

const bankDir = writableDir('banks')

const memory = new Map<string, string[]>()
// Languages with no word list upstream, so each keystroke does not retry the download.
const missing = new Map<string, number>()
const MISSING_TTL = 60 * 60 * 1000
const FREQ_ALIAS: Record<string, string> = {
  zh: 'zh_cn',
  cmn: 'zh_cn',
  yue: 'zh_tw',
  nb: 'no',
  nn: 'no',
  no: 'no',
  'pt-br': 'pt_br',
  'pt-BR': 'pt_br',
}

function freqCode(lang: string): string {
  return FREQ_ALIAS[lang] ?? lang.split('-')[0] ?? lang
}

function parseSuggestList(text: string): string[] {
  const seen = new Set<string>()
  const words: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim().split(/\s+/)[0]?.normalize('NFC')
    if (!word || /\d/.test(word) || /[._/\\]/.test(word)) continue
    if ([...word].length < 2) continue
    const key = word.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    words.push(word)
    if (words.length >= 8040) break
  }
  return words.slice(40, 8040)
}

async function downloadSuggestList(lang: string): Promise<string[]> {
  const code = freqCode(lang)
  const urls = [
    `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${code}/${code}_50k.txt`,
    `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/${code}/${code}_50k.txt`,
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Wordkeep/1.0', Accept: 'text/plain' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const text = await res.text()
      if (text.startsWith('<') || text.length < 1000) continue
      const words = parseSuggestList(text)
      if (words.length >= 200) return words
    } catch {
      /* next source */
    }
  }
  return []
}

async function getSuggestBank(lang: string): Promise<string[]> {
  // The code becomes a file name and a URL path.
  if (!isLangCode(lang)) return []
  const cached = memory.get(lang)
  if (cached?.length) return cached
  const path = join(bankDir, `suggest-${lang}.json`)
  if (existsSync(path)) {
    try {
      const words = JSON.parse(readFileSync(path, 'utf8')) as string[]
      if (Array.isArray(words) && words.length) {
        memory.set(lang, words)
        return words
      }
    } catch {
      /* rebuild */
    }
  }
  if ((missing.get(lang) ?? 0) > Date.now()) return []
  const words = await downloadSuggestList(lang)
  if (words.length) {
    try {
      writeFileSync(path, JSON.stringify(words))
    } catch {
      /* read-only disk: keep it in memory */
    }
    memory.set(lang, words)
  } else {
    missing.set(lang, Date.now() + MISSING_TTL)
  }
  return words
}

function isLatin(q: string): boolean {
  return /^[\p{Script=Latin}\p{M}'’-]+$/u.test(q)
}

export function fold(q: string): string {
  return q.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

export function detectLanguages(q: string): string[] {
  const found: string[] = []
  const add = (code: string) => {
    if (!found.includes(code)) found.push(code)
  }
  if (/[\u3040-\u30ff]/.test(q)) add('ja')
  if (/[\uac00-\ud7af]/.test(q)) add('ko')
  if (/[\u4e00-\u9fff]/.test(q)) {
    add('zh')
    add('ja')
  }
  if (/[\u0600-\u06ff]/.test(q)) {
    add('ar')
    add('fa')
    add('ur')
  }
  if (/[\u0400-\u04ff]/.test(q)) {
    add('ru')
    add('uk')
    add('bg')
  }
  if (/[\u0590-\u05ff]/.test(q)) add('he')
  if (/[\u0e00-\u0e7f]/.test(q)) add('th')
  if (/[\u0900-\u097f]/.test(q)) add('hi')
  if (/[\u0c00-\u0c7f]/.test(q)) add('te')
  if (/[\u0b80-\u0bff]/.test(q)) add('ta')
  if (/[ñ¡¿]/i.test(q) || /(?:ción|sión|ñol)\b/i.test(q)) add('es')
  if (/[ãõ]/i.test(q) || /ção\b/i.test(q)) add('pt')
  if (/ß|[äöü]/.test(q)) add('de')
  if (/[àâæçêëïîôùûÿœ]/i.test(q) || /(?:eau|eux|ée)\b/i.test(q)) add('fr')
  if (/[ąćęłńśźż]/i.test(q)) add('pl')
  if (/[őű]/.test(q)) add('hu')
  if (/[åæø]/i.test(q)) {
    add('da')
    add('nb')
    add('sv')
  }
  if (/[ìò]/i.test(q)) add('it')
  return found
}

function prefixHits(bank: string[], q: string, limit: number): { word: string; exact: boolean }[] {
  const needle = fold(q)
  const exact: { word: string; exact: boolean }[] = []
  const prefix: { word: string; exact: boolean }[] = []
  for (const word of bank) {
    const lower = fold(word)
    if (lower === needle) exact.push({ word, exact: true })
    else if (lower.startsWith(needle)) prefix.push({ word, exact: false })
    if (prefix.length >= limit && exact.length) break
  }
  return [...exact, ...prefix].slice(0, limit)
}

export async function suggestWords(
  q: string,
  preferred: string[],
): Promise<SuggestResponse> {
  const query = q.trim()
  const detectedCodes = detectLanguages(query)
  const langs: string[] = []
  const add = (code: string) => {
    const clean = (code.split('-')[0] ?? code).toLowerCase()
    if (clean && !langs.includes(clean)) langs.push(clean)
  }
  for (const code of detectedCodes) add(code)
  for (const code of preferred) add(code)
  if (isLatin(query)) {
    if (query.length >= 3) {
      for (const code of ['es', 'fr', 'it', 'pt', 'de', 'en']) add(code)
    } else {
      add('en')
    }
  }
  const searchLangs = langs.slice(0, 7)

  const banks = await Promise.all(
    searchLangs.map(async (lang) => ({ lang, words: await getSuggestBank(lang) })),
  )

  const suggestions: Suggestion[] = []
  const seen = new Set<string>()
  const preferredSet = new Set(preferred.map((code) => (code.split('-')[0] ?? code).toLowerCase()))
  const detectedSet = new Set(detectedCodes)

  const ranked: Array<Suggestion & { score: number }> = []
  for (const { lang, words } of banks) {
    if (!words.length) continue
    const hits = prefixHits(words, query, 6)
    for (const hit of hits) {
      const key = `${lang}:${hit.word.toLocaleLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      let score = hit.exact ? 120 : 80
      if (preferredSet.has(lang)) score += 18
      if (detectedSet.has(lang)) score += 14
      ranked.push({
        lemma: hit.word,
        language: lang,
        languageName: languageName(lang),
        exact: hit.exact,
        score,
      })
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.lemma.localeCompare(b.lemma))
  for (const item of ranked.slice(0, 12)) {
    suggestions.push({
      lemma: item.lemma,
      language: item.language,
      languageName: item.languageName,
      exact: item.exact,
    })
  }

  return {
    query,
    detected: detectedCodes.map((code) => ({ code, name: languageName(code) })),
    suggestions,
  }
}

export function warmupSuggestBanks(langs: string[]) {
  for (const lang of langs) {
    getSuggestBank(lang).catch(() => undefined)
  }
}

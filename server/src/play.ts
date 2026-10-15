import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlayCard, PlayRound } from '../../shared/types.ts'
import { languageName } from './languages.ts'
import { lookupWord } from './lookup.ts'
import { isLangCode } from './params.ts'
import { writableDir } from './paths.ts'

const bankDir = writableDir('banks')

const memory = new Map<string, string[]>()
// Languages with no word list upstream, so each request does not retry the download.
const missing = new Map<string, number>()
const MISSING_TTL = 60 * 60 * 1000
const NEED = 2000
// A round gives up after this many lookups or this long, so a dictionary
// outage costs a few requests instead of thousands.
const MAX_ATTEMPTS = 25
const ROUND_DEADLINE_MS = 20_000
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

export function looksLexical(word: string, lang: string): boolean {
  if (/\d/.test(word)) return false
  if (/[._/\\]/.test(word)) return false
  const script = lang.split('-')[0] ?? lang
  if (['zh', 'ja', 'ko', 'cmn', 'yue'].includes(script) || script.startsWith('zh')) {
    return [...word].length >= 2
  }
  return word.length >= 7
}

export function parseFrequency(text: string, lang: string): string[] {
  const lines = text.split(/\r?\n/)
  const all: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const word = line.trim().split(/\s+/)[0]?.normalize('NFC')
    if (!word) continue
    const key = word.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    all.push(word)
  }
  const skip = Math.min(8000, Math.floor(all.length * 0.18))
  const picked: string[] = []
  for (let i = skip; i < all.length && picked.length < NEED + 400; i += 1) {
    const word = all[i]
    if (word && looksLexical(word, lang)) picked.push(word)
  }
  if (picked.length < NEED) {
    for (const word of all) {
      if (picked.length >= NEED) break
      if (looksLexical(word, lang) && !picked.includes(word)) picked.push(word)
    }
  }
  return picked.slice(0, Math.max(NEED, picked.length))
}

async function downloadBank(lang: string): Promise<string[]> {
  const code = freqCode(lang)
  const urls = [
    `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${code}/${code}_50k.txt`,
    `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2016/${code}/${code}_50k.txt`,
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Wordkeep/1.0', Accept: 'text/plain' },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) continue
      const text = await res.text()
      if (text.startsWith('<') || text.length < 1000) continue
      const words = parseFrequency(text, lang)
      if (words.length >= NEED) return words
      if (words.length >= 800) return words
    } catch {
      /* try next source */
    }
  }
  return []
}

export async function getBank(lang: string): Promise<string[]> {
  // The code becomes a file name and a URL path.
  if (!isLangCode(lang)) return []
  const cached = memory.get(lang)
  if (cached && cached.length >= NEED) return cached
  const path = join(bankDir, `${lang}.json`)
  if (existsSync(path)) {
    try {
      const words = JSON.parse(readFileSync(path, 'utf8')) as string[]
      if (Array.isArray(words) && words.length >= NEED) {
        memory.set(lang, words)
        return words
      }
    } catch {
      /* rebuild */
    }
  }
  if ((missing.get(lang) ?? 0) > Date.now()) return []
  const words = await downloadBank(lang)
  if (words.length >= NEED) {
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

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) continue
    copy[i] = b
    copy[j] = a
  }
  return copy
}

export function shortDefinition(definition: string): string {
  const clipped = definition.replace(/\s+/g, ' ').trim()
  if (clipped.length <= 180) return clipped
  return `${clipped.slice(0, 177).replace(/\s+\S*$/, '')}…`
}

export async function buildRound(lang: string): Promise<PlayRound | null> {
  const bank = await getBank(lang)
  if (bank.length < NEED) return null
  const pool = shuffle(bank)
  const cards: PlayCard[] = []
  const used = new Set<string>()
  const deadline = Date.now() + ROUND_DEADLINE_MS
  let attempts = 0
  for (const lemma of pool) {
    if (cards.length >= 5 || attempts >= MAX_ATTEMPTS || Date.now() > deadline) break
    if (used.has(lemma.toLowerCase())) continue
    attempts += 1
    try {
      const lookup = await lookupWord(lemma, lang)
      const sense = lookup?.senses[0]
      const definition = sense?.definition?.trim()
      if (!lookup || !definition || definition.length < 24) continue
      used.add(lemma.toLowerCase())
      cards.push({
        id: crypto.randomUUID(),
        lemma: lookup.displayLemma,
        definition: shortDefinition(definition),
        partOfSpeech: sense?.partOfSpeech ?? '',
      })
    } catch {
      continue
    }
  }
  if (cards.length < 5) return null
  return {
    lang,
    languageName: languageName(lang),
    bankSize: bank.length,
    cards,
  }
}

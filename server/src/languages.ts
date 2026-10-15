import type { Language } from '../../shared/types.ts'

const FALLBACK: Language[] = [
  { code: 'en', name: 'English', words: 1365322 },
  { code: 'la', name: 'Latin', words: 833841 },
  { code: 'es', name: 'Spanish', words: 763354 },
  { code: 'it', name: 'Italian', words: 587857 },
  { code: 'ru', name: 'Russian', words: 426409 },
  { code: 'pt', name: 'Portuguese', words: 407005 },
  { code: 'fr', name: 'French', words: 387833 },
  { code: 'de', name: 'German', words: 347627 },
  { code: 'sv', name: 'Swedish', words: 301212 },
  { code: 'fi', name: 'Finnish', words: 250939 },
  { code: 'zh', name: 'Chinese', words: 173379 },
  { code: 'pl', name: 'Polish', words: 169363 },
  { code: 'nl', name: 'Dutch', words: 136677 },
  { code: 'ja', name: 'Japanese', words: 121124 },
  { code: 'el', name: 'Greek', words: 81634 },
  { code: 'hu', name: 'Hungarian', words: 72302 },
  { code: 'cs', name: 'Czech', words: 69100 },
  { code: 'uk', name: 'Ukrainian', words: 53936 },
  { code: 'da', name: 'Danish', words: 53327 },
  { code: 'ko', name: 'Korean', words: 48578 },
  { code: 'tr', name: 'Turkish', words: 40986 },
  { code: 'vi', name: 'Vietnamese', words: 38735 },
  { code: 'hi', name: 'Hindi', words: 34564 },
  { code: 'ar', name: 'Arabic', words: 25489 },
  { code: 'th', name: 'Thai', words: 17239 },
  { code: 'he', name: 'Hebrew', words: 13707 },
  { code: 'id', name: 'Indonesian', words: 32970 },
  { code: 'ca', name: 'Catalan', words: 188895 },
  { code: 'ro', name: 'Romanian', words: 124905 },
  { code: 'nb', name: 'Norwegian Bokmål', words: 70120 },
]

let cache: Language[] = FALLBACK
let fetchedAt = 0
// After a failed fetch, serve what we have for a while instead of retrying on every call.
let retryAt = 0

export async function getLanguages(force = false): Promise<Language[]> {
  const fresh = Date.now() - fetchedAt < 24 * 60 * 60 * 1000
  if (!force && fetchedAt && fresh && cache.length > FALLBACK.length) return cache
  if (!force && Date.now() < retryAt) return cache

  try {
    const res = await fetch('https://freedictionaryapi.com/api/v1/languages', {
      headers: { Accept: 'application/json', 'User-Agent': 'Wordkeep/1.0' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      retryAt = Date.now() + 10 * 60 * 1000
      return cache
    }
    const data = (await res.json()) as Language[]
    if (Array.isArray(data) && data.length > 0) {
      cache = data
        .filter((item) => item?.code && item?.name)
        .sort((a, b) => b.words - a.words || a.name.localeCompare(b.name))
      fetchedAt = Date.now()
    }
  } catch {
    // keep fallback / last cache
    retryAt = Date.now() + 10 * 60 * 1000
  }
  return cache
}

export function languageName(code: string): string {
  return cache.find((item) => item.code === code)?.name ?? code
}

export async function ensureLanguages(): Promise<void> {
  await getLanguages()
}

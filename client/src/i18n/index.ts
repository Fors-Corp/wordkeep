import { ca } from './ca'
import { de } from './de'
import { en, type MessageKey, type Messages } from './en'
import { es } from './es'
import { fr } from './fr'
import { it } from './it'
import { pt } from './pt'

export type { MessageKey } from './en'

export type Locale = 'ca' | 'es' | 'pt' | 'en' | 'de' | 'fr' | 'it'

/** App languages in the order the menu shows them, each named in itself. */
export const LOCALES: Array<{ code: Locale; native: string }> = [
  { code: 'ca', native: 'Català' },
  { code: 'es', native: 'Español' },
  { code: 'pt', native: 'Português' },
  { code: 'en', native: 'English' },
  { code: 'de', native: 'Deutsch' },
  { code: 'fr', native: 'Français' },
  { code: 'it', native: 'Italiano' },
]

const MESSAGES: Record<Locale, Messages> = { ca, es, pt, en, de, fr, it }

export type Vars = Record<string, string | number>
export type Translate = (key: MessageKey, vars?: Vars) => string
export type TranslatePlural = (key: string, count: number, vars?: Vars) => string

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in MESSAGES
}

/** First supported locale among the browser's preferred languages, else English. */
export function detectLocale(preferred: readonly string[] = []): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

function fill(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

export function translator(locale: Locale): { t: Translate; tp: TranslatePlural } {
  const messages = MESSAGES[locale]
  const rules = new Intl.PluralRules(locale)
  const t: Translate = (key, vars) => fill(messages[key] ?? en[key] ?? key, vars)
  const tp: TranslatePlural = (key, count, vars) => {
    const form = rules.select(count) === 'one' ? 'one' : 'other'
    const full = `${key}.${form}` as MessageKey
    return t(full in en ? full : (`${key}.other` as MessageKey), { count, ...vars })
  }
  return { t, tp }
}

/** Human name of a language code in the given app language, e.g. de → "alemany" in Catalan. */
export function languageNameIn(code: string, locale: Locale, fallback = code): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(code)
    if (name && name !== code) return name
  } catch {
    /* some dictionary codes are not ISO */
  }
  return fallback
}

export const english = translator('en')

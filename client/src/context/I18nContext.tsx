import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  detectLocale,
  english,
  isLocale,
  languageNameIn,
  translator,
  type Locale,
  type Translate,
  type TranslatePlural,
} from '../i18n'

const LOCALE_KEY = 'wordkeep-locale'
const EXPLAIN_KEY = 'wordkeep-explain-in-phrase-language'

type I18nValue = {
  locale: Locale
  setLocale: (next: Locale) => void
  t: Translate
  tp: TranslatePlural
  /** Explain phrases in the phrase's own language instead of the app language. */
  explainInPhrase: boolean
  setExplainInPhrase: (next: boolean) => void
  /** The language analyses of a phrase in `phraseLang` should be written in. */
  explainFor: (phraseLang: string) => string
  languageName: (code: string, fallback?: string) => string
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

function initialLocale(): Locale {
  const saved = read(LOCALE_KEY)
  if (isLocale(saved)) return saved
  if (typeof navigator === 'undefined') return 'en'
  return detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language])
}

const I18nContext = createContext<I18nValue>({
  locale: 'en',
  setLocale: () => undefined,
  t: english.t,
  tp: english.tp,
  explainInPhrase: false,
  setExplainInPhrase: () => undefined,
  explainFor: () => 'en',
  languageName: (code, fallback) => languageNameIn(code, 'en', fallback),
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [explainInPhrase, setExplainState] = useState(() => read(EXPLAIN_KEY) === '1')

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    write(LOCALE_KEY, next)
  }, [])

  const setExplainInPhrase = useCallback((next: boolean) => {
    setExplainState(next)
    write(EXPLAIN_KEY, next ? '1' : '0')
  }, [])

  const value = useMemo<I18nValue>(() => {
    const { t, tp } = translator(locale)
    return {
      locale,
      setLocale,
      t,
      tp,
      explainInPhrase,
      setExplainInPhrase,
      explainFor: (phraseLang) => (explainInPhrase && phraseLang ? phraseLang : locale),
      languageName: (code, fallback) => languageNameIn(code, locale, fallback),
    }
  }, [locale, explainInPhrase, setLocale, setExplainInPhrase])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

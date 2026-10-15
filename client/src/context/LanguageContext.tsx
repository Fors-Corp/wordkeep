import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Language } from '@shared/types'
import { api } from '../lib/api'

type LanguageContextValue = {
  languages: Language[]
  lookupLang: string
  setLookupLang: (code: string) => void
  current: Language | undefined
  loading: boolean
}

const LanguageContext = createContext<LanguageContextValue | null>(null)
const STORAGE_KEY = 'wordkeep.lookupLang'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [languages, setLanguages] = useState<Language[]>([])
  const [lookupLang, setLookupLangState] = useState(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {
      /* storage blocked: fall back to the browser language */
    }
    if (stored) return stored
    const nav = (navigator.language || 'en').split('-')[0] || 'en'
    return nav
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api
      .languages()
      .then((list) => {
        if (!cancelled) setLanguages(list)
      })
      .catch(() => {
        if (!cancelled) {
          setLanguages([{ code: 'en', name: 'English', words: 0 }])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setLookupLang = (code: string) => {
    setLookupLangState(code)
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }

  const current = useMemo(
    () => languages.find((item) => item.code === lookupLang) ?? languages[0],
    [languages, lookupLang],
  )

  const value = useMemo(
    () => ({ languages, lookupLang, setLookupLang, current, loading }),
    [languages, lookupLang, current, loading],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { EntryKind, LookupResult, PhraseAnalysis } from '@shared/types'
import { looksLikePhrase } from '@shared/phrase'
import { useLanguage } from '../context/LanguageContext'
import { api } from './api'
import { explainLanguage } from './format'

export type LookupMode = 'auto' | EntryKind

function modeFrom(value: string | null): LookupMode {
  return value === 'word' || value === 'phrase' ? value : 'auto'
}

export function kindFor(text: string, mode: LookupMode, lang: string): EntryKind {
  if (mode !== 'auto') return mode
  return looksLikePhrase(text, lang) ? 'phrase' : 'word'
}

export function useLookup() {
  const { lookupLang, setLookupLang } = useLanguage()
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const urlLang = params.get('lang') ?? ''
  const urlMode = modeFrom(params.get('kind'))
  const [query, setQueryState] = useState(urlQ)
  const [mode, setModeState] = useState<LookupMode>(urlMode)
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [phrase, setPhrase] = useState<PhraseAnalysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const typing = useRef(false)

  const kind = kindFor(query, mode, lookupLang)

  function searchFor(q: string, lang: string, nextMode: LookupMode) {
    const next: Record<string, string> = { q, lang }
    if (nextMode !== 'auto') next.kind = nextMode
    return next
  }

  function setQuery(value: string) {
    typing.current = true
    setQueryState(value)
    if (!value.trim()) setModeState('auto')
  }

  function setMode(next: LookupMode) {
    setModeState(next)
    const trimmed = query.trim()
    if (!trimmed) return
    typing.current = false
    if (kindFor(trimmed, next, lookupLang) === 'word' && trimmed.length < 2) return
    setParams(searchFor(trimmed, lookupLang, next))
  }

  function choose(lemma: string, lang: string) {
    typing.current = false
    setQueryState(lemma)
    setModeState('auto')
    setLookupLang(lang)
    setParams({ q: lemma, lang })
  }

  /** Phrases are analyzed on demand, not on every pause in typing. */
  function submitPhrase() {
    const trimmed = query.trim()
    if (!trimmed) return
    typing.current = false
    setParams(searchFor(trimmed, lookupLang, mode))
  }

  useEffect(() => {
    if (urlLang && urlLang !== lookupLang) setLookupLang(urlLang)
    if (!typing.current && urlQ !== query) setQueryState(urlQ)
    if (!typing.current) setModeState(urlMode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ, urlLang, urlMode])

  useEffect(() => {
    if (!typing.current) return
    const trimmed = query.trim()
    const timer = window.setTimeout(() => {
      typing.current = false
      if (trimmed.length < 2) {
        if (urlQ) setParams({}, { replace: true })
        return
      }
      if (kindFor(trimmed, mode, lookupLang) === 'phrase') return
      if (trimmed === urlQ && (urlLang || lookupLang) === lookupLang && urlMode === mode) return
      setParams(searchFor(trimmed, lookupLang, mode), { replace: true })
    }, 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lookupLang, mode])

  useEffect(() => {
    const q = urlQ.trim()
    const lang = urlLang || lookupLang
    const urlKind = kindFor(q, urlMode, lang)
    if (!q || (urlKind === 'word' && q.length < 2)) {
      setLookup(null)
      setPhrase(null)
      setNotFound(false)
      setError('')
      setBusy(false)
      return
    }
    const n = ++seq.current
    setBusy(true)
    setNotFound(false)
    setError('')
    const request: Promise<LookupResult | PhraseAnalysis> =
      urlKind === 'phrase' ? api.analyzePhrase(q, lang, explainLanguage()) : api.lookup(q, lang)
    request
      .then((result) => {
        if (n !== seq.current) return
        if ('tokens' in result) {
          setPhrase(result)
          setLookup(null)
        } else {
          setLookup(result)
          setPhrase(null)
        }
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
      .catch((err: Error) => {
        if (n !== seq.current) return
        setLookup(null)
        setPhrase(null)
        setNotFound(true)
        setError(err.message || `No dictionary entry for “${q}”.`)
      })
      .finally(() => {
        if (n === seq.current) setBusy(false)
      })
  }, [urlQ, urlLang, urlMode, lookupLang])

  return {
    query,
    setQuery,
    choose,
    lookup,
    phrase,
    setPhrase,
    busy,
    notFound,
    error,
    lookupLang,
    kind,
    mode,
    setMode,
    submitPhrase,
  }
}

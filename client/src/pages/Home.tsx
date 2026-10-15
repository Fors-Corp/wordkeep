import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SuggestResponse } from '@shared/types'
import { PhraseAnalysisView } from '../components/PhraseAnalysis'
import { FormsLine } from '../components/SenseExtras'
import { SenseList } from '../components/SenseList'
import { useLanguage } from '../context/LanguageContext'
import { useStats } from '../context/StatsContext'
import { useWordTrail } from '../context/WordTrailContext'
import { api } from '../lib/api'
import { explainLanguage, formatDue, isRtl } from '../lib/format'
import { lookupHref } from '../lib/paths'
import { useLookup } from '../lib/useLookup'

const emptySuggest: SuggestResponse = { query: '', detected: [], suggestions: [] }

export function Home() {
  const { current } = useLanguage()
  const { stats, recent, refresh } = useStats()
  const { visit } = useWordTrail()
  const {
    query,
    setQuery,
    choose,
    lookup,
    phrase,
    setPhrase,
    busy,
    notFound,
    error,
    kind,
    setMode,
    submitPhrase,
  } = useLookup()
  const isPhrase = kind === 'phrase'
  const navigate = useNavigate()
  const [primary, setPrimary] = useState(0)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [suggest, setSuggest] = useState<SuggestResponse>(emptySuggest)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLFormElement>(null)
  const uiLang = explainLanguage()

  useEffect(() => {
    if (!lookup) return
    setPrimary(0)
    setNote('')
    visit({
      lemma: lookup.lemma,
      lang: lookup.language,
      label: lookup.displayLemma,
      href: lookupHref(lookup.displayLemma, lookup.language),
    })
  }, [lookup?.lemma, lookup?.language, lookup?.displayLemma, visit])

  useEffect(() => {
    const q = query.trim()
    if (!q || isPhrase) {
      setSuggest(emptySuggest)
      setOpen(false)
      return
    }
    const timer = window.setTimeout(() => {
      api
        .suggest(q, current?.code || 'en', uiLang)
        .then((result) => {
          setSuggest(result)
          setActive(0)
          setOpen(result.suggestions.length > 0)
        })
        .catch(() => setSuggest(emptySuggest))
    }, 140)
    return () => window.clearTimeout(timer)
  }, [query, current?.code, uiLang, isPhrase])

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(lemma: string, lang: string) {
    setOpen(false)
    choose(lemma, lang)
  }

  function analyze() {
    setNote('')
    setSaveError('')
    submitPhrase()
  }

  async function keepPhrase() {
    if (!phrase) return
    setSaving(true)
    setSaveError('')
    try {
      const saved = await api.keepPhrase({
        text: phrase.text,
        lang: phrase.language,
        explain: uiLang,
        note,
      })
      refresh()
      setPhrase({ ...phrase, existing: { id: saved.word.id } })
      navigate(`/words/${saved.word.id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function keep() {
    if (!lookup) return
    setSaving(true)
    setSaveError('')
    try {
      const saved = await api.keep({
        q: lookup.displayLemma,
        lang: lookup.language,
        note,
        primarySenseIndex: primary,
      })
      refresh()
      navigate(`/words/${saved.word.id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
      <section>
        <p className="mb-2 text-sm uppercase tracking-[0.2em] text-gold">Introduce a word or phrase</p>
        <h1 className="lemma mb-6 max-w-xl text-4xl leading-tight sm:text-5xl">
          Type a word or a phrase. The meaning appears.
        </h1>
        <form
          ref={boxRef}
          className="relative"
          onSubmit={(event) => {
            event.preventDefault()
            if (isPhrase) {
              setOpen(false)
              analyze()
              return
            }
            const hit = suggest.suggestions[active]
            if (open && hit) pick(hit.lemma, hit.language)
          }}
        >
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPrimary(0)
              setOpen(true)
            }}
            onFocus={() => suggest.suggestions.length && setOpen(true)}
            onKeyDown={(event) => {
              if (!open || !suggest.suggestions.length) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((i) => (i + 1) % suggest.suggestions.length)
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((i) => (i - 1 + suggest.suggestions.length) % suggest.suggestions.length)
              }
              if (event.key === 'Escape') setOpen(false)
            }}
            placeholder="Type a word or phrase in any language"
            dir={isRtl(current?.code ?? 'en') ? 'rtl' : 'ltr'}
            className="lemma w-full rounded-2xl border border-rule bg-paper px-4 py-3 text-xl outline-none focus:border-accent"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-label="Word or phrase to look up"
          />
          {open && suggest.suggestions.length > 0 && (
            <ul
              className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-2xl border border-rule bg-paper shadow-xl"
              role="listbox"
            >
              {suggest.suggestions.map((item, i) => (
                <li key={`${item.language}-${item.lemma}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left ${
                      i === active ? 'bg-paper-2' : 'hover:bg-paper-2'
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(item.lemma, item.language)}
                  >
                    <span className="lemma text-lg" dir={isRtl(item.language) ? 'rtl' : 'ltr'}>
                      {item.lemma}
                    </span>
                    <span className="text-xs text-muted">
                      {item.languageName}
                      {item.exact ? ' · exact' : ''}
                      {item.language === current?.code ? ' · yours' : ''}
                      {item.language === uiLang && item.language !== current?.code ? ' · system' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-chip p-0.5 text-sm" role="group" aria-label="Look up as">
            {(['word', 'phrase'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={kind === item}
                onClick={() => setMode(item)}
                className={`rounded-full px-3 py-1 ${kind === item ? 'bg-ink text-paper' : 'text-muted'}`}
              >
                {item === 'word' ? 'Word' : 'Phrase'}
              </button>
            ))}
          </div>
          {isPhrase && (
            <button
              type="button"
              onClick={() => analyze()}
              disabled={!query.trim() || busy}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
            >
              Analyze
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          {!isPhrase && suggest.detected.length > 0 && (
            <span className="mr-2 text-gold">
              Looks like {suggest.detected.map((item) => item.name).join(', ')}.
            </span>
          )}
          {isPhrase
            ? busy
              ? 'Analyzing grammar…'
              : 'Press Enter to analyze the phrase word by word.'
            : busy
            ? 'Fetching definition, examples, synonyms…'
            : `Suggestions prefer ${current?.name ?? 'your language'} and ${uiLang === current?.code ? 'this dictionary' : 'your system language'}.`}
        </p>

        {notFound && (
          <p className="mt-6 rounded-2xl border border-dashed border-rule px-4 py-5 text-sm text-muted">
            {error || `No dictionary entry for “${query}”.`} Try another spelling or language — you
            never have to type the meaning yourself.
          </p>
        )}

        {phrase && (
          <article className="mt-8 rounded-3xl border border-rule bg-paper p-5 shadow-[0_20px_50px_-32px_rgba(28,23,18,0.45)]">
            <div className="mb-4 flex flex-wrap items-baseline gap-3">
              <h2 className="lemma text-3xl" dir={isRtl(phrase.language) ? 'rtl' : 'ltr'}>
                {phrase.text}
              </h2>
              <span className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide text-muted">
                {phrase.languageName}
              </span>
              <span className="text-xs text-muted">
                {phrase.source === 'claude' ? 'Grammar by Claude' : 'Dictionary breakdown'}
              </span>
            </div>
            {phrase.existing && (
              <p className="mb-3 text-sm text-saved">
                Already in your lexicon.{' '}
                <Link className="underline" to={`/words/${phrase.existing.id}`}>
                  Open it
                </Link>
              </p>
            )}
            <PhraseAnalysisView analysis={phrase} />
            <label className="mt-5 block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.16em] text-muted">
                Optional mnemonic
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="A memory hook if you want one."
                className="h-16 w-full rounded-xl border border-rule bg-paper-2 p-3 text-sm outline-none"
              />
            </label>
            {saveError && <p className="mt-2 text-sm text-accent">{saveError}</p>}
            <button
              type="button"
              onClick={() => void keepPhrase()}
              disabled={saving || Boolean(phrase.existing)}
              className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper disabled:opacity-50"
            >
              Keep phrase for recall
            </button>
          </article>
        )}

        {lookup && (
          <article className="mt-8 rounded-3xl border border-rule bg-paper p-5 shadow-[0_20px_50px_-32px_rgba(28,23,18,0.45)]">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="lemma text-4xl" dir={isRtl(lookup.language) ? 'rtl' : 'ltr'}>
                {lookup.displayLemma}
              </h2>
              {lookup.phonetic && <span className="text-muted">{lookup.phonetic}</span>}
              <span className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide text-muted">
                {lookup.languageName}
              </span>
            </div>
            <FormsLine forms={lookup.forms} />
            {lookup.fallbackFrom && (
              <p className="mt-2 text-sm text-gold">
                No entry in the selected dictionary. Showing {lookup.languageName}.
              </p>
            )}
            {lookup.existing && (
              <p className="mt-2 text-sm text-saved">
                Already in your lexicon.{' '}
                <Link className="underline" to={`/words/${lookup.existing.id}`}>
                  Open it
                </Link>
              </p>
            )}
            {lookup.etymology && (
              <blockquote className="mt-4 border-l-2 border-gold pl-4 text-sm leading-relaxed text-muted">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.18em] text-gold">
                  Etymology
                </span>
                {lookup.etymology}
              </blockquote>
            )}
            <div className="mt-5">
              <h3 className="mb-3 text-xs uppercase tracking-[0.16em] text-gold">Definitions</h3>
              <SenseList
                senses={lookup.senses}
                language={lookup.language}
                primaryIndex={primary}
                onPick={(index) => setPrimary(index)}
              />
            </div>
            {lookup.translations.length > 0 && (
              <p className="mt-4 text-sm text-muted">
                Linked across {lookup.translations.length} languages
                {lookup.translations.slice(0, 8).map((item) => (
                  <span key={`${item.language}-${item.lemma}`} className="ml-2 text-ink">
                    {item.lemma}
                    <span className="ml-1 font-mono text-[10px] uppercase text-muted">
                      {item.language}
                    </span>
                  </span>
                ))}
                {lookup.translations.length > 8 ? ' …' : ''}
              </p>
            )}
            <label className="mt-5 block">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.16em] text-muted">
                Optional mnemonic — not the definition
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="A memory hook if you want one. The meaning above is already filled in."
                className="h-16 w-full rounded-xl border border-rule bg-paper-2 p-3 text-sm outline-none"
              />
            </label>
            {saveError && <p className="mt-2 text-sm text-accent">{saveError}</p>}
            <button
              type="button"
              onClick={() => void keep()}
              disabled={saving || Boolean(lookup.existing)}
              className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper disabled:opacity-50"
            >
              Keep for recall
            </button>
          </article>
        )}
      </section>

      <aside className="space-y-6">
        <div className="rounded-3xl border border-rule bg-paper-2 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-gold">Today</p>
          <p className="lemma mt-2 text-5xl">{stats?.dueToday ?? '—'}</p>
          <p className="text-sm text-muted">cards due</p>
          <Link
            to="/review"
            className="mt-4 inline-block rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            Review {stats?.dueToday ?? 0} cards
          </Link>
          <p className="mt-4 text-sm text-muted">
            {stats?.lexiconCount ?? 0} kept · {stats?.newCount ?? 0} new ·{' '}
            {stats?.languageCount ?? 0} languages
            {stats?.phraseCount ? ` · ${stats.phraseCount} phrases` : ''}
          </p>
        </div>
        <div>
          <h2 className="mb-3 text-xs uppercase tracking-[0.18em] text-muted">Recently kept</h2>
          <ul className="space-y-2">
            {recent.length === 0 && <li className="text-sm text-muted">Nothing kept yet.</li>}
            {recent.map((word) => (
              <li key={word.id}>
                <Link
                  to={`/words/${word.id}`}
                  className="block rounded-2xl border border-rule bg-paper px-4 py-3 hover:border-accent"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="lemma text-xl" dir={isRtl(word.language) ? 'rtl' : 'ltr'}>
                      {word.displayLemma}
                    </span>
                    <span className="font-mono text-[10px] uppercase text-muted">
                      {word.language}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{word.gloss}</p>
                  <p className="mt-1 text-xs text-gold">{formatDue(word.dueAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

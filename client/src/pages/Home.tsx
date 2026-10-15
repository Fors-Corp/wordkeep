import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SuggestResponse } from '@shared/types'
import { PhraseAnalysisView } from '../components/PhraseAnalysis'
import { FormsLine } from '../components/SenseExtras'
import { SenseList } from '../components/SenseList'
import { useI18n } from '../context/I18nContext'
import { useLanguage } from '../context/LanguageContext'
import { useLexicon } from '../context/LexiconContext'
import { useWordTrail } from '../context/WordTrailContext'
import { api } from '../lib/api'
import { ApiError } from '../lib/api'
import { errorText } from '../lib/errors'
import { formatDue, isRtl } from '../lib/format'
import { lookupHref } from '../lib/paths'
import { useLookup } from '../lib/useLookup'
import { SampleButton } from '../components/SampleButton'

const emptySuggest: SuggestResponse = { query: '', detected: [], suggestions: [] }

function systemLanguage(): string {
  const tag = typeof navigator === 'undefined' ? 'en' : navigator.language || 'en'
  return tag.split('-')[0]?.toLowerCase() || 'en'
}

export function Home() {
  const { current } = useLanguage()
  const { t, tp, languageName } = useI18n()
  const { device, lexicon, stats, recent, ready } = useLexicon()
  const { visit } = useWordTrail()
  const {
    query,
    setQuery,
    choose,
    lookup,
    phrase,
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
  const [saveError, setSaveError] = useState('')
  const [suggest, setSuggest] = useState<SuggestResponse>(emptySuggest)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLFormElement>(null)
  const uiLang = systemLanguage()
  const lookupKeptId = lookup ? lexicon.findId(lookup.displayLemma, lookup.language) : null
  const phraseKeptId = phrase ? lexicon.findId(phrase.text, phrase.language) : null
  const dictionaryName = current ? languageName(current.code, current.name) : t('home.yourLanguage')

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

  function keepPhrase() {
    if (!phrase || !device) return
    setSaveError('')
    try {
      const saved = device.keepPhrase(phrase, note)
      navigate(`/words/${saved.id}`)
    } catch (err) {
      setSaveError(errorText(err, t, t('home.saveFailed')))
    }
  }

  function keep() {
    if (!lookup || !device) return
    setSaveError('')
    try {
      const saved = device.keepLookup(lookup, { note, primarySenseIndex: primary })
      navigate(`/words/${saved.id}`)
    } catch (err) {
      setSaveError(errorText(err, t, t('home.saveFailed')))
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
      <section>
        <p className="mb-2 text-sm uppercase tracking-[0.2em] text-gold">{t('home.eyebrow')}</p>
        <h1 className="lemma mb-6 max-w-xl text-4xl leading-tight sm:text-5xl">{t('home.title')}</h1>
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
            placeholder={t('home.placeholder')}
            dir={isRtl(current?.code ?? 'en') ? 'rtl' : 'ltr'}
            className="lemma w-full rounded-2xl border border-rule bg-paper px-4 py-3 text-xl outline-none focus:border-accent"
            autoFocus
            lang={current?.code ?? 'en'}
            autoCapitalize={isPhrase ? 'sentences' : 'none'}
            autoCorrect="on"
            spellCheck
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-label={t('home.inputLabel')}
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
                      {languageName(item.language, item.languageName)}
                      {item.exact ? ` · ${t('home.exact')}` : ''}
                      {item.language === current?.code ? ` · ${t('home.yours')}` : ''}
                      {item.language === uiLang && item.language !== current?.code
                        ? ` · ${t('home.system')}`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{t('home.lookUpAs')}</span>
          <div
            className="inline-flex rounded-full bg-chip p-0.5 text-sm"
            role="group"
            aria-label={t('home.lookUpAs')}
          >
            {(['word', 'phrase'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={kind === item}
                onClick={() => setMode(item)}
                className={`rounded-full px-3 py-1 ${kind === item ? 'bg-ink text-paper' : 'text-muted'}`}
              >
                {item === 'word' ? t('home.word') : t('home.phrase')}
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
              {t('home.analyze')}
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          {!isPhrase && suggest.detected.length > 0 && (
            <span className="mr-2 text-gold">
              {t('home.looksLike', {
                languages: suggest.detected.map((item) => languageName(item.code, item.name)).join(', '),
              })}
            </span>
          )}
          {isPhrase
            ? busy
              ? t('home.analyzing')
              : t('home.pressEnter')
            : busy
              ? t('home.fetching')
              : t(uiLang === current?.code ? 'home.suggestThis' : 'home.suggestSystem', {
                  language: dictionaryName,
                })}
        </p>

        {notFound && (
          <p className="mt-6 rounded-2xl border border-dashed border-rule px-4 py-5 text-sm text-muted">
            {!error || (error instanceof ApiError && error.status === 404)
              ? t('home.notFound', { q: query.trim() })
              : errorText(error, t)}{' '}
            {t('home.notFoundHint')}
          </p>
        )}

        {phrase && (
          <article className="mt-8 rounded-3xl border border-rule bg-paper p-5 shadow-[0_20px_50px_-32px_var(--wk-shadow)]">
            <div className="mb-4 flex flex-wrap items-baseline gap-3">
              <h2 className="lemma text-3xl" dir={isRtl(phrase.language) ? 'rtl' : 'ltr'}>
                {phrase.text}
              </h2>
              <span className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide text-muted">
                {languageName(phrase.language, phrase.languageName)}
              </span>
              <span className="text-xs text-muted">
                {phrase.source === 'claude' ? t('home.byClaude') : t('home.byDictionary')}
              </span>
            </div>
            {phraseKeptId && (
              <p className="mb-3 text-sm text-saved">
                {t('home.alreadyKept')}{' '}
                <Link className="underline" to={`/words/${phraseKeptId}`}>
                  {t('home.openIt')}
                </Link>
              </p>
            )}
            <PhraseAnalysisView analysis={phrase} />
            <label className="mt-5 block">
              <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-muted">
                {t('home.mnemonic')}
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('home.mnemonicPhrase')}
                className="h-16 w-full rounded-xl border border-rule bg-paper-2 p-3 text-sm outline-none"
              />
            </label>
            {saveError && <p className="mt-2 text-sm text-accent">{saveError}</p>}
            <button
              type="button"
              onClick={() => keepPhrase()}
              disabled={!ready || Boolean(phraseKeptId)}
              className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper disabled:opacity-50"
            >
              {t('home.keepPhrase')}
            </button>
          </article>
        )}

        {lookup && (
          <article className="mt-8 rounded-3xl border border-rule bg-paper p-5 shadow-[0_20px_50px_-32px_var(--wk-shadow)]">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="lemma text-4xl" dir={isRtl(lookup.language) ? 'rtl' : 'ltr'}>
                {lookup.displayLemma}
              </h2>
              {lookup.phonetic && <span className="text-muted">{lookup.phonetic}</span>}
              <span className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide text-muted">
                {languageName(lookup.language, lookup.languageName)}
              </span>
            </div>
            <FormsLine forms={lookup.forms} />
            {lookup.fallbackFrom && (
              <p className="mt-2 text-sm text-gold">
                {t('home.fallbackFrom', { language: languageName(lookup.language, lookup.languageName) })}
              </p>
            )}
            {lookupKeptId && (
              <p className="mt-2 text-sm text-saved">
                {t('home.alreadyKept')}{' '}
                <Link className="underline" to={`/words/${lookupKeptId}`}>
                  {t('home.openIt')}
                </Link>
              </p>
            )}
            {lookup.etymology && (
              <blockquote className="mt-4 border-l-2 border-gold pl-4 text-sm leading-relaxed text-muted">
                <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-gold">
                  {t('home.etymology')}
                </span>
                {lookup.etymology}
              </blockquote>
            )}
            <div className="mt-5">
              <h3 className="mb-3 text-xs uppercase tracking-[0.16em] text-gold">{t('home.definitions')}</h3>
              <SenseList
                senses={lookup.senses}
                language={lookup.language}
                primaryIndex={primary}
                onPick={(index) => setPrimary(index)}
              />
            </div>
            {lookup.translations.length > 0 && (
              <p className="mt-4 text-sm text-muted">
                {tp('home.linkedAcross', lookup.translations.length)}
                {lookup.translations.slice(0, 8).map((item) => (
                  <span key={`${item.language}-${item.lemma}`} className="ml-2 text-ink">
                    {item.lemma}
                    <span className="ml-1 font-mono text-xs uppercase text-muted">
                      {item.language}
                    </span>
                  </span>
                ))}
                {lookup.translations.length > 8 ? ' …' : ''}
              </p>
            )}
            <label className="mt-5 block">
              <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-muted">
                {t('home.mnemonicWord')}
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('home.mnemonicWordHint')}
                className="h-16 w-full rounded-xl border border-rule bg-paper-2 p-3 text-sm outline-none"
              />
            </label>
            {saveError && <p className="mt-2 text-sm text-accent">{saveError}</p>}
            <button
              type="button"
              onClick={() => keep()}
              disabled={!ready || Boolean(lookupKeptId)}
              className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper disabled:opacity-50"
            >
              {t('home.keepWord')}
            </button>
          </article>
        )}
      </section>

      <aside className="space-y-6">
        <div className="rounded-3xl border border-rule bg-paper-2 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-gold">{t('home.today')}</p>
          <p className="lemma mt-2 text-5xl">{stats?.dueToday ?? '—'}</p>
          <p className="text-sm text-muted">{t('home.cardsDue')}</p>
          <Link
            to="/review"
            className="mt-4 inline-block rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            {tp('home.reviewCards', stats?.dueToday ?? 0)}
          </Link>
          <p className="mt-4 text-sm text-muted">
            {[
              t('home.kept', { count: stats?.lexiconCount ?? 0 }),
              t('home.new', { count: stats?.newCount ?? 0 }),
              tp('home.languages', stats?.languageCount ?? 0),
              stats?.phraseCount ? tp('home.phrases', stats.phraseCount) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div>
          <h2 className="mb-3 text-xs uppercase tracking-[0.18em] text-muted">{t('home.recent')}</h2>
          <ul className="space-y-2">
            {ready && recent.length === 0 && (
              <li className="text-sm text-muted">
                {t('home.nothingKept')}
                <SampleButton className="mt-3 block" />
              </li>
            )}
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
                    <span className="font-mono text-xs uppercase text-muted">
                      {word.language}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{word.gloss}</p>
                  <p className="mt-1 text-xs text-gold">{formatDue(word.dueAt, undefined, t)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}

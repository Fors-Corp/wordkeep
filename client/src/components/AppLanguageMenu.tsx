import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../context/I18nContext'
import { LOCALES } from '../i18n'

function GlobeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M2.75 10h14.5M10 2.75c2 2.1 3 4.5 3 7.25s-1 5.15-3 7.25c-2-2.1-3-4.5-3-7.25s1-5.15 3-7.25Z" />
    </svg>
  )
}

/**
 * Header menu for the app's own language, plus whether phrase analyses are
 * written in that language or in the phrase's language. A popover on wide
 * screens, a bottom sheet on phones.
 */
export function AppLanguageMenu() {
  const { locale, setLocale, t, explainInPhrase, setExplainInPhrase, languageName } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const switchHintId = useId()

  useEffect(() => {
    if (!open) return
    firstRef.current?.focus()
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = LOCALES.find((item) => item.code === locale) ?? LOCALES[3]!

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-full border border-rule bg-paper-2 px-3 py-1.5 text-sm text-ink hover:border-accent"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('appLang.button')}: ${current.native}`}
        title={t('appLang.button')}
      >
        <GlobeIcon />
        <span className="font-mono text-xs uppercase tracking-wide">{current.code}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-ink/30 sm:hidden" aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-labelledby={headingId}
            className="fixed inset-x-0 bottom-0 z-40 max-h-[85svh] overflow-y-auto rounded-t-3xl border border-rule bg-paper p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:rounded-2xl sm:pb-4"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule sm:hidden" aria-hidden="true" />
            <h2 id={headingId} className="mb-3 text-xs uppercase tracking-[0.18em] text-gold">
              {t('appLang.heading')}
            </h2>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={headingId}>
              {LOCALES.map((item, index) => {
                const selected = item.code === locale
                return (
                  <button
                    key={item.code}
                    ref={index === 0 ? firstRef : undefined}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    lang={item.code}
                    onClick={() => setLocale(item.code)}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm ${
                      selected ? 'border-accent bg-chip text-ink' : 'border-rule hover:border-ink'
                    }`}
                  >
                    <span className="font-medium">{item.native}</span>
                    <span className={`font-mono text-xs uppercase ${selected ? 'text-accent' : 'text-muted'}`}>
                      {selected ? '✓' : item.code}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 border-t border-rule pt-4">
              <button
                type="button"
                role="switch"
                aria-checked={explainInPhrase}
                aria-describedby={switchHintId}
                onClick={() => setExplainInPhrase(!explainInPhrase)}
                className="flex w-full items-center justify-between gap-3 text-left text-sm"
              >
                <span className="font-medium">{t('appLang.explainOwn')}</span>
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                    explainInPhrase ? 'bg-accent' : 'bg-rule'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform ${
                      explainInPhrase ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>
              <p id={switchHintId} className="mt-2 text-xs leading-relaxed text-muted">
                {explainInPhrase
                  ? t('appLang.explainOwnOn')
                  : t('appLang.explainOwnOff', { language: languageName(locale, current.native) })}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

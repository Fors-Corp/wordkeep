import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../context/I18nContext'
import { LOCALES } from '../i18n'
import { Flag } from './Flag'

/**
 * Header menu for the app's own language, plus whether phrase analyses are
 * written in that language or in the phrase's language. A popover on wide
 * screens, a bottom sheet on phones.
 */
export function AppLanguageMenu() {
  const { locale, setLocale, t, explainInPhrase, setExplainInPhrase, languageName } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([])
  const headingId = useId()
  const switchHintId = useId()

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const selected = LOCALES.findIndex((item) => item.code === locale)
    radioRefs.current[Math.max(0, selected)]?.focus()
    // pointerdown, not mousedown: iOS Safari fires no mouse events for taps on plain areas.
    const onDoc = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      // Keep Tab inside the menu while it is open.
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), [href], input'),
      ]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
    // Focus moves to the checked language only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** Arrow keys move through the languages and pick them, like any radio group. */
  function onRadioKey(event: React.KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = (index + step + LOCALES.length) % LOCALES.length
    setLocale(LOCALES[next]!.code)
    radioRefs.current[next]?.focus()
  }

  const current = LOCALES.find((item) => item.code === locale) ?? LOCALES[3]!

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-rule bg-paper-2 py-1.5 pl-2 pr-3 text-sm text-ink hover:border-accent"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('appLang.button')}: ${current.native}`}
        title={t('appLang.button')}
      >
        <Flag locale={current.code} className="h-3.5 w-5" />
        <span className="font-mono text-xs uppercase tracking-wide">{current.code}</span>
        <span className="text-muted" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-ink/30 sm:hidden" aria-hidden="true" onClick={() => close()} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
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
                    ref={(element) => {
                      radioRefs.current[index] = element
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    lang={item.code}
                    onClick={() => setLocale(item.code)}
                    onKeyDown={(event) => onRadioKey(event, index)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm ${
                      selected ? 'border-accent bg-chip text-ink' : 'border-rule hover:border-ink'
                    }`}
                  >
                    <Flag locale={item.code} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.native}</span>
                      <span className="block font-mono text-xs uppercase text-muted">{item.code}</span>
                    </span>
                    {selected && (
                      <span className="text-accent" aria-hidden="true">
                        ✓
                      </span>
                    )}
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

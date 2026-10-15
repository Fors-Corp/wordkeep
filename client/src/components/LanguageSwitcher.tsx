import { useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { languageLine, nativeLanguageName } from '../lib/format'

export function LanguageSwitcher() {
  const { languages, lookupLang, setLookupLang, current } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return languages
    return languages.filter((item) => {
      const native = nativeLanguageName(item.code, item.name).toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        native.includes(q)
      )
    })
  }, [languages, query])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-56 items-center gap-2 rounded-full border border-rule bg-paper-2 px-3 py-1.5 text-left text-sm text-ink"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-mono text-xs uppercase tracking-wide text-gold">
          {lookupLang}
        </span>
        <span className="truncate">{current?.name ?? 'Language'}</span>
        <span className="ml-auto text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-2xl border border-rule bg-paper shadow-xl">
          <div className="border-b border-rule p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${languages.length} languages`}
              className="w-full rounded-xl border border-rule bg-paper-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted">No language matches.</li>
            )}
            {filtered.map((item) => {
              const active = item.code === lookupLang
              return (
                <li key={item.code}>
                  <button
                    type="button"
                    className={`flex w-full items-baseline justify-between px-3 py-2 text-left text-sm ${
                      active ? 'bg-chip text-accent' : 'hover:bg-paper-2'
                    }`}
                    onClick={() => {
                      setLookupLang(item.code)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span>
                      <span className="font-medium">
                        {nativeLanguageName(item.code, item.name)}
                      </span>
                      <span className="ml-2 text-muted">
                        {languageLine(item.code, item.name).includes('·')
                          ? item.name
                          : item.code}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {item.words > 0 ? item.words.toLocaleString() : item.code}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

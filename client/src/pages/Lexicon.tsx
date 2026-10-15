import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { WordSummary } from '@shared/types'
import { useI18n } from '../context/I18nContext'
import { useLanguage } from '../context/LanguageContext'
import { capitalize, type MessageKey } from '../i18n'
import { api } from '../lib/api'
import { formatDue, isRtl, statusLabel } from '../lib/format'

const FILTERS = ['all', 'due', 'new', 'learning', 'review', 'mastered', 'archived'] as const
const KINDS = [
  { value: '', label: 'lexicon.kind.all' },
  { value: 'word', label: 'lexicon.kind.word' },
  { value: 'phrase', label: 'lexicon.kind.phrase' },
] as const

const FILTER_LABELS: Record<(typeof FILTERS)[number], MessageKey> = {
  all: 'lexicon.filter.all',
  due: 'lexicon.filter.due',
  new: 'lexicon.filter.new',
  learning: 'lexicon.filter.learning',
  review: 'lexicon.filter.review',
  mastered: 'lexicon.filter.mastered',
  archived: 'lexicon.filter.archived',
}

export function Lexicon() {
  const { languages } = useLanguage()
  const { t, languageName, locale } = useI18n()
  const [params, setParams] = useSearchParams()
  const [words, setWords] = useState<WordSummary[]>([])
  const [error, setError] = useState('')
  const [backupBusy, setBackupBusy] = useState('')
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? 'all'
  const language = params.get('language') ?? ''
  const kind = params.get('kind') ?? ''

  function currentQuery(): Record<string, string | undefined> {
    const query: Record<string, string | undefined> = {
      q: q || undefined,
      language: language || undefined,
      kind: kind || undefined,
    }
    if (status === 'due') query.due = 'today'
    else if (status !== 'all') query.status = status
    return query
  }

  useEffect(() => {
    api
      .words(currentQuery())
      .then(setWords)
      .catch((err: Error) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, language, kind])

  async function downloadBackup() {
    setBackupBusy('export')
    setError('')
    try {
      const backup = await api.exportLexicon()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `wordkeep-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(href)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lexicon.exportFailed'))
    } finally {
      setBackupBusy('')
    }
  }

  async function uploadBackup(file: File, mode: 'merge' | 'replace') {
    setBackupBusy(mode)
    setError('')
    try {
      const backup = JSON.parse(await file.text()) as unknown
      await api.importLexicon(backup, mode)
      setWords(await api.words(currentQuery()))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lexicon.importFailed'))
    } finally {
      setBackupBusy('')
    }
  }

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value)
      else merged.delete(key)
    }
    setParams(merged)
  }

  const usedLangs = [...new Set(words.map((word) => word.language))]

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-gold">{t('lexicon.eyebrow')}</p>
          <h1 className="lemma text-4xl">{t('lexicon.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(event) => update({ q: event.target.value })}
            placeholder={t('lexicon.search')}
            className="w-full max-w-xs rounded-full border border-rule bg-paper px-4 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => void downloadBackup()}
            className="rounded-full border border-rule px-3 py-1.5 text-sm"
            disabled={Boolean(backupBusy)}
          >
            {backupBusy === 'export' ? t('lexicon.exporting') : t('lexicon.export')}
          </button>
          <label className="cursor-pointer rounded-full border border-rule px-3 py-1.5 text-sm">
            {backupBusy === 'merge' || backupBusy === 'replace' ? t('lexicon.importing') : t('lexicon.import')}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              disabled={Boolean(backupBusy)}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const replace = window.confirm(t('lexicon.replaceConfirm'))
                void uploadBackup(file, replace ? 'replace' : 'merge')
              }}
            />
          </label>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => update({ status: item === 'all' ? '' : item })}
            className={`rounded-full px-3 py-1 text-sm ${
              (item === 'all' && status === 'all') || item === status
                ? 'bg-ink text-paper'
                : 'bg-chip text-muted'
            }`}
          >
            {t(FILTER_LABELS[item])}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('lexicon.kind.label')}>
        {KINDS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={kind === item.value}
            onClick={() => update({ kind: item.value })}
            className={`rounded-full px-3 py-1 text-xs ${
              kind === item.value ? 'bg-ink text-paper' : 'bg-chip text-muted'
            }`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      {(usedLangs.length > 1 || language) && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => update({ language: '' })}
            className={`rounded-full px-3 py-1 text-xs ${language ? 'bg-chip text-muted' : 'bg-ink text-paper'}`}
          >
            {t('lexicon.everyLanguage')}
          </button>
          {(language && !usedLangs.includes(language) ? [language, ...usedLangs] : usedLangs).map(
            (code) => (
              <button
                key={code}
                type="button"
                onClick={() => update({ language: code })}
                className={`rounded-full px-3 py-1 text-xs ${
                  language === code ? 'bg-ink text-paper' : 'bg-chip text-muted'
                }`}
              >
                {capitalize(languageName(code, languages.find((item) => item.code === code)?.name ?? code), locale)}
              </button>
            ),
          )}
        </div>
      )}

      {error && <p className="text-accent">{error}</p>}

      {words.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-rule px-4 py-12 text-center text-muted">
          {t('lexicon.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-rule rounded-3xl border border-rule bg-paper">
          {words.map((word) => (
            <li key={word.id}>
              <Link
                to={`/words/${word.id}`}
                className="flex flex-wrap items-baseline gap-3 px-4 py-3 hover:bg-paper-2"
              >
                <span
                  className={`lemma min-w-32 ${word.kind === 'phrase' ? 'text-xl' : 'text-2xl'}`}
                  dir={isRtl(word.language) ? 'rtl' : 'ltr'}
                >
                  {word.displayLemma}
                </span>
                {word.kind === 'phrase' && (
                  <span className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide text-phrase">
                    {t('lexicon.phraseBadge')}
                  </span>
                )}
                <span className="min-w-48 flex-1 text-sm text-muted line-clamp-2 sm:line-clamp-1">{word.gloss}</span>
                <span className="font-mono text-xs uppercase text-gold">{word.language}</span>
                <span className="text-xs text-muted">{statusLabel(word.status, t)}</span>
                <span className="text-xs text-accent">{formatDue(word.dueAt, undefined, t)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { Link } from 'react-router-dom'
import type { SenseDraft } from '@shared/types'
import { useI18n } from '../context/I18nContext'
import { lookupHref } from '../lib/paths'

function TermRow({
  label,
  terms,
  language,
  kind,
  linked,
}: {
  label: string
  terms: string[]
  language: string
  kind: 'syn' | 'ant'
  linked: boolean
}) {
  if (!terms.length) return null
  const tone = kind === 'syn' ? 'border-saved/30 text-saved' : 'border-accent/30 text-accent'
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="text-xs uppercase tracking-[0.14em] text-muted">{label}</span>
      {terms.map((term) =>
        linked ? (
          <Link
            key={term}
            to={lookupHref(term, language)}
            className={`rounded-full border bg-paper px-2 py-0.5 text-[13px] hover:border-ink ${tone}`}
          >
            {term}
          </Link>
        ) : (
          <span
            key={term}
            className={`rounded-full border bg-paper px-2 py-0.5 text-[13px] ${tone}`}
          >
            {term}
          </span>
        ),
      )}
    </p>
  )
}

export function SenseExtras({
  sense,
  language,
  linked = true,
  compact = false,
}: {
  sense: SenseDraft
  language: string
  linked?: boolean
  compact?: boolean
}) {
  const { t } = useI18n()
  const examples = (sense.examples ?? []).filter(Boolean).slice(0, compact ? 1 : 3)

  return (
    <div className="mt-2">
      {(sense.tags ?? []).length > 0 && (
        <p className="mb-1 flex flex-wrap gap-1">
          {(sense.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-chip px-2 py-0.5 text-xs uppercase tracking-wide text-muted"
            >
              {tag}
            </span>
          ))}
        </p>
      )}
      {examples.map((example) => (
        <p key={example} className="text-sm italic text-muted">
          “{example}”
        </p>
      ))}
      <TermRow
        label={t('sense.synonyms')}
        terms={(sense.synonyms ?? []).slice(0, compact ? 8 : 14)}
        language={language}
        kind="syn"
        linked={linked}
      />
      <TermRow
        label={t('sense.antonyms')}
        terms={(sense.antonyms ?? []).slice(0, compact ? 8 : 14)}
        language={language}
        kind="ant"
        linked={linked}
      />
    </div>
  )
}

export function FormsLine({
  forms,
}: {
  forms: Array<{ word: string; tags: string[] }>
}) {
  const { t } = useI18n()
  if (!forms.length) return null
  return (
    <p className="mt-2 text-sm text-muted">
      <span className="mr-2 text-xs uppercase tracking-[0.14em]">{t('sense.forms')}</span>
      {forms.map((form, index) => (
        <span key={`${form.word}-${index}`}>
          {index > 0 ? ' · ' : ''}
          <span className="text-ink">{form.word}</span>
          {form.tags.length > 0 && (
            <span className="ml-1 text-xs">({form.tags.join(', ')})</span>
          )}
        </span>
      ))}
    </p>
  )
}

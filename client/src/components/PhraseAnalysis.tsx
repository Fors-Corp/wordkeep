import { Link } from 'react-router-dom'
import type { PhraseAnalysis, PhraseToken } from '@shared/types'
import { useI18n } from '../context/I18nContext'
import type { MessageKey } from '../i18n'
import { en } from '../i18n/en'
import { lookupHref } from '../lib/paths'
import { isRtl, posLabel, posShort, posTone } from '../lib/format'

/** Spells out the abbreviations used in this phrase, in their colors. */
function PosKey({ tokens }: { tokens: PhraseToken[] }) {
  const { t } = useI18n()
  const seen = new Map<string, string>()
  for (const token of tokens) {
    const pos = token.partOfSpeech.trim().toLowerCase()
    if (token.punct || !pos || seen.has(pos)) continue
    seen.set(pos, posShort(pos, t))
  }
  if (!seen.size) return null
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label={t('phrase.posKey')}>
      {[...seen].map(([pos, short]) => (
        <span key={pos}>
          <span className={`font-mono uppercase ${posTone(pos)}`}>{short}</span> {posLabel(pos, t)}
        </span>
      ))}
    </p>
  )
}

/** The analysis note in the app language when the server sent a code for it. */
function noticeText(analysis: PhraseAnalysis, t: ReturnType<typeof useI18n>['t']): string | null {
  const notice = analysis.notice
  if (notice) {
    const key = `notice.${notice.code}`
    if (key in en) return t(key as MessageKey, notice.params)
  }
  return analysis.note
}

function TokenChip({
  token,
  language,
  linked,
  highlight,
}: {
  token: PhraseToken
  language: string
  linked: boolean
  highlight: boolean
}) {
  const { t } = useI18n()
  if (token.punct) {
    return <span className="lemma self-center px-0.5 text-2xl text-muted">{token.text}</span>
  }
  const body = (
    <>
      <span className="block h-4 text-xs uppercase tracking-[0.12em] text-muted">{token.role}</span>
      <span className="lemma block text-2xl leading-tight">{token.text}</span>
      <span className={`block font-mono text-xs uppercase ${posTone(token.partOfSpeech)}`}>
        {token.partOfSpeech ? posShort(token.partOfSpeech, t) : '?'}
      </span>
    </>
  )
  const className = `rounded-xl border px-2 py-1 text-center ${
    highlight ? 'border-accent bg-paper' : 'border-transparent hover:border-rule'
  }`
  const title = [token.lemma, posLabel(token.partOfSpeech, t), ...token.features].filter(Boolean).join(' · ')
  return linked ? (
    <Link to={lookupHref(token.lemma || token.text, language)} className={className} title={title}>
      {body}
    </Link>
  ) : (
    <span className={className} title={title}>
      {body}
    </span>
  )
}

function Facts({ analysis }: { analysis: PhraseAnalysis }) {
  const { t } = useI18n()
  const facts = (
    [
      ['phrase.fact.type', analysis.sentenceType],
      ['phrase.fact.tense', analysis.tense],
      ['phrase.fact.mood', analysis.mood],
      ['phrase.fact.voice', analysis.voice],
    ] as Array<[MessageKey, string]>
  ).filter(([, value]) => value)
  if (!facts.length) return null
  return (
    <dl className="mt-4 flex flex-wrap gap-2 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="rounded-full bg-chip px-3 py-1">
          <dt className="inline text-xs uppercase tracking-[0.14em] text-muted">{t(label)} </dt>
          <dd className="inline">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PhraseAnalysisView({
  analysis,
  linked = true,
  highlight,
  compact = false,
}: {
  analysis: PhraseAnalysis
  linked?: boolean
  highlight?: number
  compact?: boolean
}) {
  const { t } = useI18n()
  const words = analysis.tokens.filter((token) => !token.punct)
  const rtl = isRtl(analysis.language)
  const note = noticeText(analysis, t)

  return (
    <div>
      <div
        className="flex flex-wrap items-end gap-1"
        dir={rtl ? 'rtl' : 'ltr'}
        aria-label={t('phrase.breakdown')}
      >
        {analysis.tokens.map((token) => (
          <TokenChip
            key={token.index}
            token={token}
            language={analysis.language}
            linked={linked}
            highlight={token.index === highlight}
          />
        ))}
      </div>
      <PosKey tokens={analysis.tokens} />

      {analysis.translation && (
        <p className="mt-4 text-lg leading-relaxed">
          <span className="mr-2 text-xs uppercase tracking-[0.16em] text-gold">{t('phrase.meaning')}</span>
          {analysis.translation}
        </p>
      )}
      {analysis.summary && <p className="mt-2 leading-relaxed text-muted">{analysis.summary}</p>}
      <Facts analysis={analysis} />

      {analysis.idioms.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-gold">{t('phrase.idioms')}</h3>
          <ul className="space-y-1 text-sm">
            {analysis.idioms.map((idiom) => (
              <li key={idiom.text}>
                <span className="lemma text-base">{idiom.text}</span>
                <span className="text-muted"> — {idiom.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && analysis.clauses.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-gold">{t('phrase.clauses')}</h3>
          <ul className="space-y-2 text-sm">
            {analysis.clauses.map((clause, index) => (
              <li key={`${clause.text}-${index}`} className="rounded-xl bg-paper-2 px-3 py-2">
                <span className="mr-2 text-xs uppercase tracking-[0.14em] text-accent">{clause.type}</span>
                <span className="lemma text-base">{clause.text}</span>
                {clause.explanation && <p className="mt-1 text-muted">{clause.explanation}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-gold">{t('phrase.wordByWord')}</h3>
          <ul className="divide-y divide-rule rounded-2xl border border-rule">
            {words.map((token) => (
              <li key={token.index} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="lemma text-lg" dir={rtl ? 'rtl' : 'ltr'}>
                    {token.text}
                  </span>
                  {token.lemma && token.lemma.toLowerCase() !== token.text.toLowerCase() && (
                    <span className="text-muted">← {token.lemma}</span>
                  )}
                  <span className={`text-xs ${posTone(token.partOfSpeech)}`}>
                    {token.partOfSpeech ? posLabel(token.partOfSpeech, t) : t('phrase.notInDictionary')}
                  </span>
                  {token.role && <span className="text-xs text-muted">· {token.role}</span>}
                  {token.features.length > 0 && (
                    <span className="text-xs text-muted">· {token.features.join(', ')}</span>
                  )}
                </div>
                {token.explanation && <p className="mt-0.5">{token.explanation}</p>}
                {token.gloss && <p className="mt-0.5 text-muted line-clamp-2">{token.gloss}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {note && (
        <p role="note" className="mt-4 rounded-xl bg-chip px-3 py-2 text-sm text-muted">
          {note}
        </p>
      )}
    </div>
  )
}

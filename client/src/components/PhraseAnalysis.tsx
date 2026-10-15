import { Link } from 'react-router-dom'
import type { PhraseAnalysis, PhraseToken } from '@shared/types'
import { lookupHref } from '../lib/paths'
import { isRtl, posShort, posTone } from '../lib/format'

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
  if (token.punct) {
    return <span className="lemma self-center px-0.5 text-2xl text-muted">{token.text}</span>
  }
  const body = (
    <>
      <span className="block h-4 text-[10px] uppercase tracking-[0.12em] text-muted">{token.role}</span>
      <span className="lemma block text-2xl leading-tight">{token.text}</span>
      <span className={`block font-mono text-[10px] uppercase ${posTone(token.partOfSpeech)}`}>
        {token.partOfSpeech ? posShort(token.partOfSpeech) : '?'}
      </span>
    </>
  )
  const className = `rounded-xl border px-2 py-1 text-center ${
    highlight ? 'border-accent bg-paper' : 'border-transparent hover:border-rule'
  }`
  const title = [token.lemma, token.partOfSpeech, ...token.features].filter(Boolean).join(' · ')
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
  const facts = [
    ['type', analysis.sentenceType],
    ['tense', analysis.tense],
    ['mood', analysis.mood],
    ['voice', analysis.voice],
  ].filter(([, value]) => value)
  if (!facts.length) return null
  return (
    <dl className="mt-4 flex flex-wrap gap-2 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="rounded-full bg-chip px-3 py-1">
          <dt className="inline text-[11px] uppercase tracking-[0.14em] text-muted">{label} </dt>
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
  const words = analysis.tokens.filter((token) => !token.punct)
  const rtl = isRtl(analysis.language)

  return (
    <div>
      <div
        className="flex flex-wrap items-end gap-1"
        dir={rtl ? 'rtl' : 'ltr'}
        aria-label="Word-by-word breakdown"
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

      {analysis.translation && (
        <p className="mt-4 text-lg leading-relaxed">
          <span className="mr-2 text-[11px] uppercase tracking-[0.16em] text-gold">Meaning</span>
          {analysis.translation}
        </p>
      )}
      {analysis.summary && <p className="mt-2 leading-relaxed text-muted">{analysis.summary}</p>}
      <Facts analysis={analysis} />

      {analysis.idioms.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-gold">Idioms and fixed expressions</h3>
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
          <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-gold">Clauses</h3>
          <ul className="space-y-2 text-sm">
            {analysis.clauses.map((clause, index) => (
              <li key={`${clause.text}-${index}`} className="rounded-xl bg-paper-2 px-3 py-2">
                <span className="mr-2 text-[11px] uppercase tracking-[0.14em] text-accent">{clause.type}</span>
                <span className="lemma text-base">{clause.text}</span>
                {clause.explanation && <p className="mt-1 text-muted">{clause.explanation}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-[0.16em] text-gold">Word by word</h3>
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
                    {token.partOfSpeech || 'not in the dictionary'}
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

      {analysis.note && <p className="mt-4 text-xs text-muted">{analysis.note}</p>}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PlayCard, PlayRound } from '@shared/types'
import { useI18n } from '../context/I18nContext'
import { useLanguage } from '../context/LanguageContext'
import { ApiError } from '../lib/api'
import { useLexicon } from '../context/LexiconContext'
import { api } from '../lib/api'
import { hashHue, isRtl, posLabel } from '../lib/format'
import { lookupHref } from '../lib/paths'

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) continue
    copy[i] = b
    copy[j] = a
  }
  return copy
}

export function Discover() {
  const { lookupLang, current } = useLanguage()
  const { device } = useLexicon()
  const { t, languageName } = useI18n()
  const dictionaryName = current ? languageName(current.code, current.name) : languageName(lookupLang)
  const [round, setRound] = useState<PlayRound | null>(null)
  const [meanings, setMeanings] = useState<PlayCard[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [pairs, setPairs] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kept, setKept] = useState<Record<string, string>>({})

  async function loadRound() {
    setBusy(true)
    setError('')
    setChecked(false)
    setPairs({})
    setPicked(null)
    setKept({})
    try {
      const next = await api.playRound(lookupLang)
      setRound(next)
      setMeanings(shuffle(next.cards))
    } catch (err) {
      setRound(null)
      setError(
        err instanceof ApiError && err.status === 404
          ? t('discover.noBank', { lang: dictionaryName })
          : err instanceof Error
            ? err.message
            : t('discover.failed'),
      )
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupLang])

  const reverse = useMemo(() => {
    const map: Record<string, string> = {}
    for (const [wordId, meaningId] of Object.entries(pairs)) map[meaningId] = wordId
    return map
  }, [pairs])

  function onWord(id: string) {
    if (checked) return
    if (picked === id) {
      setPicked(null)
      return
    }
    setPicked(id)
  }

  function onMeaning(id: string) {
    if (checked || !picked) return
    setPairs((current) => {
      const next = { ...current }
      for (const [wordId, meaningId] of Object.entries(next)) {
        if (meaningId === id || wordId === picked) delete next[wordId]
      }
      next[picked] = id
      return next
    })
    setPicked(null)
  }

  const assignedCount = Object.keys(pairs).length
  const score = round
    ? round.cards.filter((card) => pairs[card.id] === card.id).length
    : 0

  async function keepCard(card: PlayCard) {
    try {
      if (!device) return
      const saved = device.keepLookup(await api.lookup(card.lemma, lookupLang))
      setKept((current) => ({ ...current, [card.id]: saved.id }))
    } catch {
      /* the dictionary had no entry for it */
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs uppercase tracking-[0.18em] text-gold">{t('discover.eyebrow')}</p>
      <h1 className="lemma mt-2 text-4xl">{t('discover.title')}</h1>
      <p className="mt-3 max-w-xl text-muted">{t('discover.intro', { language: dictionaryName })}</p>

      {round && (
        <p className="mt-2 text-sm text-muted">
          {t('discover.bank', { count: round.bankSize.toLocaleString(), paired: assignedCount })}
        </p>
      )}

      {busy && (
        <p className="mt-8 text-muted">{t('discover.drawing', { language: dictionaryName })}</p>
      )}

      {error && !busy && (
        <div className="mt-8 rounded-2xl border border-dashed border-rule px-4 py-8 text-center">
          <p className="text-muted">{error}</p>
          <button
            type="button"
            onClick={() => void loadRound()}
            className="mt-4 rounded-full bg-ink px-4 py-2 text-sm text-paper"
          >
            {t('discover.tryAgain')}
          </button>
        </div>
      )}

      {round && !busy && (
        <>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <section>
              <h2 className="mb-3 text-xs uppercase tracking-[0.16em] text-muted">{t('discover.words')}</h2>
              <ul className="space-y-2">
                {round.cards.map((card) => {
                  const hue = hashHue(card.id)
                  const paired = Boolean(pairs[card.id])
                  const selected = picked === card.id
                  const correct = checked && pairs[card.id] === card.id
                  const wrong = checked && pairs[card.id] !== card.id
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => onWord(card.id)}
                        dir={isRtl(lookupLang) ? 'rtl' : 'ltr'}
                        className={`lemma w-full rounded-2xl border px-4 py-3 text-left text-xl ${
                          selected
                            ? 'border-ink bg-ink text-paper'
                            : paired
                              ? 'border-transparent text-ink'
                              : 'border-rule bg-paper'
                        }`}
                        style={
                          paired && !selected
                            ? { background: `hsl(${hue} 40% 88%)`, borderColor: `hsl(${hue} 40% 55%)` }
                            : undefined
                        }
                      >
                        {card.lemma}
                        {card.partOfSpeech && (
                          <span className="ml-2 font-sans text-xs uppercase tracking-wide opacity-70">
                            {posLabel(card.partOfSpeech, t)}
                          </span>
                        )}
                        {checked && (
                          <span className="ml-2 font-sans text-sm">
                            {correct ? '✓' : wrong ? '✗' : ''}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-xs uppercase tracking-[0.16em] text-muted">{t('discover.meanings')}</h2>
              <ul className="space-y-2">
                {meanings.map((card) => {
                  const owner = reverse[card.id]
                  const hue = owner ? hashHue(owner) : 0
                  const word = round.cards.find((item) => item.id === owner)
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => onMeaning(card.id)}
                        disabled={checked}
                        className="w-full rounded-2xl border border-rule bg-paper px-4 py-3 text-left text-sm leading-relaxed disabled:cursor-default"
                        style={
                          owner
                            ? { background: `hsl(${hue} 40% 88%)`, borderColor: `hsl(${hue} 40% 55%)` }
                            : undefined
                        }
                      >
                        {word && (
                          <span className="lemma mb-1 block text-base">{word.lemma}</span>
                        )}
                        {card.definition}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!checked ? (
              <button
                type="button"
                disabled={assignedCount < 5}
                onClick={() => setChecked(true)}
                className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-paper disabled:opacity-40"
              >
                {t('discover.check')}
              </button>
            ) : (
              <p className="lemma text-2xl">
                {score} / 5
                <span className="ml-2 font-sans text-sm text-muted">
                  {score === 5 ? t('discover.allMatched') : t('discover.lookAgain')}
                </span>
              </p>
            )}
            <button
              type="button"
              onClick={() => void loadRound()}
              className="rounded-full border border-rule px-4 py-2 text-sm"
            >
              {t('discover.fiveNew')}
            </button>
          </div>

          {checked && (
            <ul className="mt-6 space-y-2">
              {round.cards.map((card) => (
                <li
                  key={card.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl border border-rule px-4 py-3"
                >
                  <div>
                    <Link
                      to={lookupHref(card.lemma, lookupLang)}
                      className="lemma text-xl"
                      dir={isRtl(lookupLang) ? 'rtl' : 'ltr'}
                    >
                      {card.lemma}
                    </Link>
                    <p className="text-sm text-muted">{card.definition}</p>
                  </div>
                  {kept[card.id] ? (
                    <Link to={`/words/${kept[card.id]}`} className="text-sm text-saved">
                      {t('discover.kept')}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void keepCard(card)}
                      className="text-sm text-accent"
                    >
                      {t('discover.keep')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

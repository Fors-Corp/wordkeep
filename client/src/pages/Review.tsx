import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Grade, WordDetail } from '@shared/types'
import { phraseCardFor, type PhraseCard } from '@shared/phrase'
import { previewInterval, recallStateFrom } from '@shared/sm2'
import { PhraseAnalysisView } from '../components/PhraseAnalysis'
import { SenseExtras } from '../components/SenseExtras'
import { useI18n } from '../context/I18nContext'
import type { MessageKey, Translate } from '../i18n'
import { useStats } from '../context/StatsContext'
import { api } from '../lib/api'
import { isRtl, posLabel } from '../lib/format'

const GRADE_META: Array<{ grade: Grade; label: MessageKey; key: string }> = [
  { grade: 'again', label: 'review.again', key: '1' },
  { grade: 'hard', label: 'review.hard', key: '2' },
  { grade: 'good', label: 'review.good', key: '3' },
  { grade: 'easy', label: 'review.easy', key: '4' },
]

function seedFrom(id: string): number {
  let total = 0
  for (const char of id) total = (total + char.charCodeAt(0)) % 997
  return total
}

const PHRASE_PROMPT: Record<PhraseCard['mode'], MessageKey> = {
  meaning: 'review.mode.meaning',
  cloze: 'review.mode.cloze',
  grammar: 'review.mode.grammar',
}

/** Dictionary-made questions carry a template so they read in the app language. */
function localizedQuiz(quiz: PhraseCard, card: WordDetail, t: Translate): PhraseCard {
  if (quiz.mode === 'cloze') {
    const token = card.analysis?.tokens[quiz.tokenIndex]
    const hint = token
      ? [token.lemma && token.lemma !== token.text ? token.lemma : '', posLabel(token.partOfSpeech, t)]
          .filter(Boolean)
          .join(' · ')
      : quiz.hint
    return { ...quiz, hint }
  }
  if (quiz.mode !== 'grammar') return quiz
  const source = card.analysis?.questions.find((item) => item.question === quiz.question)
  const template = source?.template
  if (!template) return quiz
  const pos = posLabel(template.partOfSpeech, t)
  return template.kind === 'form'
    ? {
        mode: 'grammar',
        question: t('quiz.form', { lemma: template.lemma, text: template.text }),
        answer: `${template.features.join(', ')}${pos ? ` (${pos})` : ''}`,
      }
    : { mode: 'grammar', question: t('quiz.pos', { text: template.text }), answer: pos }
}

function PhraseFront({ card, quiz }: { card: WordDetail; quiz: PhraseCard }) {
  const { t, languageName } = useI18n()
  const dir = isRtl(card.language) ? 'rtl' : 'ltr'
  return (
    <>
      <p className="text-xs uppercase tracking-[0.18em] text-gold">
        {languageName(card.language, card.languageName)} · {t(PHRASE_PROMPT[quiz.mode])}
      </p>
      <h1 className="lemma mt-3 text-center text-3xl sm:text-4xl" dir={dir}>
        {quiz.mode === 'cloze' ? quiz.prompt : card.displayLemma}
      </h1>
      {quiz.mode === 'cloze' && quiz.hint && <p className="mt-3 text-muted">({quiz.hint})</p>}
      {quiz.mode === 'grammar' && <p className="mt-5 text-center text-lg">{quiz.question}</p>}
    </>
  )
}

function PhraseBack({ card, quiz }: { card: WordDetail; quiz: PhraseCard }) {
  const { t } = useI18n()
  return (
    <>
      {quiz.mode === 'cloze' && (
        <p className="lemma text-3xl" dir={isRtl(card.language) ? 'rtl' : 'ltr'}>
          {quiz.answer}
        </p>
      )}
      {quiz.mode === 'grammar' && (
        <p className="text-lg leading-relaxed">
          <span className="mr-2 text-xs uppercase tracking-[0.16em] text-accent">{t('review.answer')}</span>
          {quiz.answer}
        </p>
      )}
      {quiz.mode === 'meaning' && !card.analysis?.translation && (
        <p className="text-lg leading-relaxed">{card.gloss}</p>
      )}
      {card.analysis ? (
        <div className={quiz.mode === 'meaning' ? '' : 'mt-4 border-t border-rule pt-4'}>
          <PhraseAnalysisView
            analysis={card.analysis}
            linked={false}
            compact
            highlight={quiz.mode === 'cloze' ? quiz.tokenIndex : undefined}
          />
        </div>
      ) : (
        quiz.mode !== 'meaning' && <p className="mt-4 text-muted">{card.gloss}</p>
      )}
    </>
  )
}

export function Review() {
  const { refresh } = useStats()
  const { t, languageName } = useI18n()
  const [queue, setQueue] = useState<WordDetail[]>([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [loading, setLoading] = useState(true)

  const card = queue[index]
  const hints = card
    ? {
        again: previewInterval(recallStateFrom(card), 'again'),
        hard: previewInterval(recallStateFrom(card), 'hard'),
        good: previewInterval(recallStateFrom(card), 'good'),
        easy: previewInterval(recallStateFrom(card), 'easy'),
      }
    : null

  useEffect(() => {
    api
      .queue()
      .then(setQueue)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (card) setFlipped(false)
  }, [card?.id])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        setFlipped(true)
      }
      const meta = GRADE_META.find((item) => item.key === event.key)
      if (meta && flipped) void grade(meta.grade)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, card, queue, index])

  async function grade(value: Grade) {
    if (!card) return
    await api.grade(card.id, value)
    refresh()
    setDone((n) => n + 1)
    const remaining = queue.filter((_, i) => i !== index)
    if (value === 'again') remaining.push(card)
    setQueue(remaining)
    setIndex(0)
    setFlipped(false)
  }

  if (loading) return <p className="text-muted">{t('review.loading')}</p>

  if (!card) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="lemma text-4xl">{t('review.nothingDue')}</h1>
        <p className="mt-3 text-muted">{t('review.waiting')}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/" className="rounded-full bg-accent px-4 py-2 text-sm text-paper">
            {t('review.introduce')}
          </Link>
          <Link to="/words" className="rounded-full border border-rule px-4 py-2 text-sm">
            {t('review.openLexicon')}
          </Link>
        </div>
      </div>
    )
  }

  const primary =
    card.senses.find((sense) => sense.id === card.primarySenseId) ?? card.senses[0]
  const quiz =
    card.kind === 'phrase'
      ? localizedQuiz(phraseCardFor(card.analysis, card.repetitions + seedFrom(card.id)), card, t)
      : null

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-4 text-sm text-muted">
        {t('review.progress', { index: index + 1, total: queue.length, done })}
      </p>
      <div className="[perspective:1400px]">
        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          className={`card-face relative min-h-[340px] w-full rounded-3xl border border-rule bg-paper text-left shadow-[0_30px_60px_-40px_var(--wk-shadow)] ${
            flipped ? 'is-flipped' : ''
          }`}
        >
          <div className="card-side absolute inset-0 flex flex-col items-center justify-center p-8">
            {quiz ? (
              <PhraseFront card={card} quiz={quiz} />
            ) : (
              <>
                <p className="text-xs uppercase tracking-[0.18em] text-gold">
                  {languageName(card.language, card.languageName)}
                </p>
                <h1
                  className="lemma mt-3 text-center text-5xl sm:text-6xl"
                  dir={isRtl(card.language) ? 'rtl' : 'ltr'}
                >
                  {card.displayLemma}
                </h1>
                {card.phonetic && <p className="mt-3 text-muted">{card.phonetic}</p>}
              </>
            )}
            <p className="mt-8 text-sm text-muted">{t('review.flip')}</p>
          </div>
          <div className="card-side card-back absolute inset-0 overflow-auto p-8">
            {quiz ? (
              <PhraseBack card={card} quiz={quiz} />
            ) : (
              <>
                <p className="text-xs uppercase tracking-[0.16em] text-accent">
                  {primary ? posLabel(primary.partOfSpeech, t) : ''}
                </p>
                <p className="mt-2 text-lg leading-relaxed">{primary?.definition}</p>
                {primary && (
                  <SenseExtras sense={primary} language={card.language} linked={false} compact />
                )}
              </>
            )}
            {card.etymology && (
              <p className="mt-4 border-t border-rule pt-4 text-sm text-muted">{card.etymology}</p>
            )}
            {card.note && <p className="mt-4 rounded-xl bg-paper-2 p-3 text-sm">{card.note}</p>}
          </div>
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {flipped ? t('review.hintAfter') : t('review.hintBefore')}
      </p>
      <div className={`mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 ${flipped ? '' : 'opacity-40'}`}>
        {GRADE_META.map((item) => (
          <button
            key={item.grade}
            type="button"
            disabled={!flipped}
            onClick={() => void grade(item.grade)}
            className="rounded-2xl border border-rule bg-paper-2 px-3 py-3 text-sm disabled:cursor-not-allowed"
          >
            <span className="block font-semibold">{t(item.label)}</span>
            <span className="text-xs text-muted">
              {item.key} · {hints?.[item.grade] ?? ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

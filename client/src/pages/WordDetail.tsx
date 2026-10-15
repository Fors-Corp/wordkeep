import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { GraphPayload, WordDetail } from '@shared/types'
import { PhraseAnalysisView } from '../components/PhraseAnalysis'
import { FormsLine } from '../components/SenseExtras'
import { SenseList } from '../components/SenseList'
import { WordGraph } from '../components/WordGraph'
import { useI18n } from '../context/I18nContext'
import { useStats } from '../context/StatsContext'
import { useWordTrail } from '../context/WordTrailContext'
import { api } from '../lib/api'
import { keptHref, lookupHref } from '../lib/paths'
import { errorText } from '../lib/errors'
import { formatDue, isRtl, statusLabel } from '../lib/format'

export function WordPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { refresh } = useStats()
  const { t, explainFor, languageName } = useI18n()
  const { visit } = useWordTrail()
  const [word, setWord] = useState<WordDetail | null>(null)
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] })
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)

  useEffect(() => {
    if (!id) return
    api
      .word(id)
      .then((item) => {
        setWord(item)
        setNote(item.note)
      })
      .catch((err: Error) => setError(err.message))
    api.graph(id).then(setGraph).catch(() => undefined)
  }, [id])

  useEffect(() => {
    if (!word) return
    visit({
      lemma: word.lemma,
      lang: word.language,
      label: word.displayLemma,
      href: keptHref(word.id),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [word?.id, word?.lemma, word?.language, word?.displayLemma, visit])

  async function saveNote() {
    if (!word) return
    setSaving(true)
    try {
      setWord(await api.patch(word.id, { note }))
    } catch (err) {
      setError(errorText(err, t, t('word.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function reanalyze() {
    if (!word) return
    setReanalyzing(true)
    setError('')
    try {
      setWord(await api.reanalyze(word.id, explainFor(word.language)))
    } catch (err) {
      setError(errorText(err, t, t('word.analysisFailed')))
    } finally {
      setReanalyzing(false)
    }
  }

  async function toggleArchive() {
    if (!word) return
    setWord(await api.patch(word.id, { archived: !word.archivedAt }))
    refresh()
  }

  async function remove() {
    if (!word) return
    if (!confirm(t('word.deleteConfirm', { word: word.displayLemma }))) return
    await api.remove(word.id)
    refresh()
    navigate('/words')
  }

  if (error && !word) return <p className="text-accent">{error}</p>
  if (!word) return <p className="text-muted">{t('common.loading')}</p>
  const isPhrase = word.kind === 'phrase'

  return (
    <article className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-gold">
          {isPhrase ? `${t('word.phrase')} · ` : ''}
          {languageName(word.language, word.languageName)} · {statusLabel(word.status, t)} ·{' '}
          {formatDue(word.dueAt, undefined, t)}
        </p>
        <h1
          className={`lemma mt-2 ${isPhrase ? 'text-4xl sm:text-5xl' : 'text-5xl sm:text-6xl'}`}
          dir={isRtl(word.language) ? 'rtl' : 'ltr'}
        >
          {word.displayLemma}
        </h1>
        {isPhrase && (
          <div className="mt-6">
            {word.analysis ? (
              <PhraseAnalysisView analysis={word.analysis} />
            ) : (
              <p className="text-muted">{word.gloss}</p>
            )}
            <button
              type="button"
              onClick={() => void reanalyze()}
              disabled={reanalyzing}
              className="mt-4 rounded-full border border-rule px-4 py-2 text-sm disabled:opacity-50"
            >
              {reanalyzing ? t('word.analyzing') : t('word.reanalyze')}
            </button>
            {error && <p className="mt-2 text-sm text-accent">{error}</p>}
          </div>
        )}
        {word.phonetic && <p className="mt-2 text-lg text-muted">{word.phonetic}</p>}
        <FormsLine forms={word.forms} />

        {word.etymology && (
          <blockquote className="mt-6 border-l-2 border-gold pl-4 leading-relaxed text-muted">
            <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-gold">
              {t('home.etymology')}
            </span>
            {word.etymology}
          </blockquote>
        )}

        {!isPhrase && (
          <div className="mt-8">
            <SenseList
              senses={word.senses}
              language={word.language}
              primaryId={word.primarySenseId}
              onPick={async (_index, sense) => {
                if (!sense.id) return
                setWord(await api.patch(word.id, { primarySenseId: sense.id }))
              }}
            />
          </div>
        )}

        <label className="mt-8 block">
          <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-muted">
            {t('word.mnemonic')}
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => void saveNote()}
            className="h-28 w-full rounded-2xl border border-rule bg-paper-2 p-3 text-sm outline-none"
          />
        </label>
        <p className="mt-1 text-xs text-muted">{saving ? t('word.saving') : t('word.savedOnBlur')}</p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void toggleArchive()}
            className="rounded-full border border-rule px-4 py-2 text-sm"
          >
            {word.archivedAt ? t('word.restore') : t('word.archive')}
          </button>
          <button type="button" onClick={() => void remove()} className="rounded-full px-4 py-2 text-sm text-accent">
            {t('word.delete')}
          </button>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="lemma text-2xl">{t('word.atlas')}</h2>
          <Link to={`/graph/${word.id}`} className="text-sm text-accent">
            {t('word.expand')}
          </Link>
        </div>
        <WordGraph nodes={graph.nodes} edges={graph.edges} height={380} cap={36} />
        <ul className="max-h-80 overflow-y-auto rounded-2xl border border-rule">
          {word.links.slice(0, 80).map((link) => (
            <li
              key={link.id}
              className="flex items-baseline justify-between gap-3 border-b border-rule px-3 py-2 last:border-b-0"
            >
              <Link
                to={link.toWordId ? keptHref(link.toWordId) : lookupHref(link.lemma, link.language)}
                className="lemma text-lg"
                dir={isRtl(link.language) ? 'rtl' : 'ltr'}
              >
                {link.lemma}
              </Link>
              <span className="text-xs text-muted">
                {t(`relation.${link.relation}`)}
                {' · '}
                {languageName(link.language, link.languageName)}
                {link.toWordId ? ` · ${t('word.kept')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </article>
  )
}

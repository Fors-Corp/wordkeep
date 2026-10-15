import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { WordGraph } from '../components/WordGraph'
import { useI18n } from '../context/I18nContext'
import { useLexicon } from '../context/LexiconContext'

export function GraphPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { lexicon } = useLexicon()
  const [mode, setMode] = useState<'word' | 'lexicon'>(id ? 'word' : 'lexicon')
  const words = useMemo(() => lexicon.list(), [lexicon])
  const payload = useMemo(() => lexicon.graph(mode === 'word' ? id : undefined), [lexicon, mode, id])

  const selected = words.find((word) => word.id === id)
  const languages = useMemo(
    () => [...new Set(payload.nodes.map((node) => node.languageName))].length,
    [payload],
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-gold">{t('graph.eyebrow')}</p>
          <h1 className="lemma text-4xl">{t('graph.title')}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">{t('graph.intro')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('lexicon')
              navigate('/graph')
            }}
            className={`rounded-full px-3 py-1 text-sm ${
              mode === 'lexicon' ? 'bg-ink text-paper' : 'bg-chip text-muted'
            }`}
          >
            {t('graph.whole')}
          </button>
          <button
            type="button"
            onClick={() => setMode('word')}
            className={`rounded-full px-3 py-1 text-sm ${
              mode === 'word' ? 'bg-ink text-paper' : 'bg-chip text-muted'
            }`}
          >
            {t('graph.one')}
          </button>
        </div>
      </div>

      {mode === 'word' && (
        <label className="mb-4 block max-w-sm text-sm">
          {t('graph.centerOn')}
          <select
            value={id ?? ''}
            onChange={(event) => {
              const next = event.target.value
              if (next) navigate(`/graph/${next}`)
            }}
            className="mt-1 w-full rounded-xl border border-rule bg-paper px-3 py-2"
          >
            <option value="">{t('graph.choose')}</option>
            {words.map((word) => (
              <option key={word.id} value={word.id}>
                {word.displayLemma} ({word.language})
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="mb-3 text-sm text-muted">
        {t('graph.stats', { nodes: payload.nodes.length, links: payload.edges.length, languages })}
        {selected ? ` · ${t('graph.centered', { word: selected.displayLemma })}` : ''}
      </p>

      <WordGraph
        nodes={payload.nodes}
        edges={payload.edges}
        height={560}
        cap={mode === 'word' ? 80 : 120}
      />

      {selected && (
        <p className="mt-3 text-sm">
          <Link className="text-accent" to={`/words/${selected.id}`}>
            {t('graph.open', { word: selected.displayLemma })}
          </Link>
        </p>
      )}
    </div>
  )
}

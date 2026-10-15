import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { GraphPayload, WordSummary } from '@shared/types'
import { WordGraph } from '../components/WordGraph'
import { api } from '../lib/api'

export function GraphPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<GraphPayload>({ nodes: [], edges: [] })
  const [words, setWords] = useState<WordSummary[]>([])
  const [mode, setMode] = useState<'word' | 'lexicon'>(id ? 'word' : 'lexicon')

  useEffect(() => {
    api.words().then(setWords).catch(() => undefined)
  }, [])

  useEffect(() => {
    const wordId = mode === 'word' ? id : undefined
    api.graph(wordId).then(setPayload).catch(() => undefined)
  }, [id, mode])

  const selected = words.find((word) => word.id === id)
  const languages = useMemo(
    () => [...new Set(payload.nodes.map((node) => node.languageName))].length,
    [payload],
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-gold">Related words</p>
          <h1 className="lemma text-4xl">Atlas</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Drag to rotate the 3D atlas so overlapping links separate. Green is synonym, dashed
            terracotta antonym, gold translation, dotted slate related, olive phrase. Labels are not selectable.
            Click a node to open it.
          </p>
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
            Whole lexicon
          </button>
          <button
            type="button"
            onClick={() => setMode('word')}
            className={`rounded-full px-3 py-1 text-sm ${
              mode === 'word' ? 'bg-ink text-paper' : 'bg-chip text-muted'
            }`}
          >
            One word
          </button>
        </div>
      </div>

      {mode === 'word' && (
        <label className="mb-4 block max-w-sm text-sm">
          Center on
          <select
            value={id ?? ''}
            onChange={(event) => {
              const next = event.target.value
              if (next) navigate(`/graph/${next}`)
            }}
            className="mt-1 w-full rounded-xl border border-rule bg-paper px-3 py-2"
          >
            <option value="">Choose a kept word</option>
            {words.map((word) => (
              <option key={word.id} value={word.id}>
                {word.displayLemma} ({word.language})
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="mb-3 text-sm text-muted">
        {payload.nodes.length} nodes · {payload.edges.length} links · {languages} languages
        {selected ? ` · centered on ${selected.displayLemma}` : ''}
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
            Open {selected.displayLemma}
          </Link>
        </p>
      )}
    </div>
  )
}

import { useEffect } from 'react'
import { isRtl, trailModifierLabel, trailModifierPressed } from '../lib/format'
import { useWordTrail } from '../context/WordTrailContext'

export function WordTrailBar() {
  const { trail, index, canBack, canForward, back, forward, jump } = useWordTrail()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }
      if (trailModifierPressed(event) && event.key === 'ArrowLeft') {
        event.preventDefault()
        back()
      }
      if (trailModifierPressed(event) && event.key === 'ArrowRight') {
        event.preventDefault()
        forward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, forward])

  if (trail.length === 0) return null

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-rule bg-paper-2 px-3 py-2">
      <button
        type="button"
        onClick={back}
        disabled={!canBack}
        className="rounded-full px-3 py-1 text-sm disabled:opacity-30"
        aria-label="Previous word"
      >
        ← Back
      </button>
      <button
        type="button"
        onClick={forward}
        disabled={!canForward}
        className="rounded-full px-3 py-1 text-sm disabled:opacity-30"
        aria-label="Next word"
      >
        Forward →
      </button>
      <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden">
        {trail.map((stop, i) => (
          <li key={`${stop.href}-${i}`} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted">›</span>}
            <button
              type="button"
              onClick={() => jump(i)}
              dir={isRtl(stop.lang) ? 'rtl' : 'ltr'}
              className={`lemma max-w-40 truncate rounded-full px-2 py-0.5 text-sm ${
                i === index ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
              }`}
            >
              {stop.label}
            </button>
          </li>
        ))}
      </ol>
      <span className="hidden text-xs uppercase tracking-wide text-muted sm:inline">
        {trailModifierLabel()} ← / →
      </span>
    </div>
  )
}

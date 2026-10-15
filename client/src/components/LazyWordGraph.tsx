import { lazy, Suspense, type ComponentProps } from 'react'
import type { WordGraph } from './WordGraph'

// three.js is most of the app's code; load it only where an atlas is shown.
const Graph = lazy(() => import('./WordGraph').then((module) => ({ default: module.WordGraph })))

export function LazyWordGraph(props: ComponentProps<typeof WordGraph>) {
  const height = props.height ?? 420
  return (
    <Suspense
      fallback={
        <div
          className="rounded-2xl border border-rule bg-paper-2"
          style={{ height: `min(${height}px, 60svh)` }}
          aria-busy="true"
        />
      }
    >
      <Graph {...props} />
    </Suspense>
  )
}

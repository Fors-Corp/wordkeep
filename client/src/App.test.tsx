import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { LanguageProvider } from './context/LanguageContext'
import { StatsProvider } from './context/StatsContext'
import { WordTrailProvider } from './context/WordTrailContext'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <StatsProvider>
          <WordTrailProvider>
            <App />
          </WordTrailProvider>
        </StatsProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('app routes', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/languages')) {
          return json([{ code: 'en', name: 'English', words: 1 }])
        }
        if (url.includes('/api/stats')) {
          return json({ dueToday: 2, newCount: 1, lexiconCount: 4, languageCount: 1 })
        }
        if (url.includes('/api/words/recent') || url.includes('/api/words')) {
          return json([])
        }
        if (url.includes('/api/graph')) return json({ nodes: [], edges: [] })
        if (url.includes('/api/review/queue')) return json([])
        if (url.includes('/api/play/round')) {
          return json({ error: 'No 2,000-word discovery bank' }, 404)
        }
        if (url.includes('/api/suggest')) return json({ query: '', detected: [], suggestions: [] })
        return json({ error: url }, 404)
      }),
    )
  })

  it('renders Introduce on the home route', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: /Type a word/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Introduce' })).toBeInTheDocument()
  })

  it('renders Lexicon, Atlas, Review, and Discover headings', async () => {
    const lexicon = renderAt('/words')
    expect(await screen.findByRole('heading', { name: 'Lexicon' })).toBeInTheDocument()
    lexicon.unmount()

    const atlas = renderAt('/graph')
    expect(await screen.findByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
    atlas.unmount()
  })

  it('links to the support page from the footer', async () => {
    renderAt('/')
    const link = await screen.findByRole('link', { name: 'Support · 1,99 €' })
    expect(link).toHaveAttribute('href', 'https://marcfors.com/donate?from=wordkeep')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('redirects unknown routes home', async () => {
    renderAt('/nope')
    expect(await screen.findByRole('heading', { name: /Type a word/i })).toBeInTheDocument()
  })
})

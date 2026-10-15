import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { LanguageProvider } from '../context/LanguageContext'
import { StatsProvider } from '../context/StatsContext'
import { WordTrailProvider } from '../context/WordTrailContext'
import { phraseFixture, phraseWord } from '../test/phrase-fixture'

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

let fetchMock: ReturnType<typeof vi.fn>
let queue: unknown[] = []

function calls(part: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(part))
}

describe('phrases', () => {
  beforeEach(() => {
    queue = []
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/languages')) return json([{ code: 'en', name: 'English', words: 1 }])
      if (url.includes('/api/stats')) {
        return json({ dueToday: 1, newCount: 1, lexiconCount: 2, languageCount: 1, phraseCount: 1 })
      }
      if (url.includes('/api/phrase/analyze')) return json(phraseFixture())
      if (url.includes('/api/phrases') && init?.method === 'POST') {
        return json({ alreadyKept: false, word: phraseWord() }, 201)
      }
      if (url.includes('/api/words/p1')) return json(phraseWord())
      if (url.includes('/api/words')) return json([])
      if (url.includes('/api/graph')) return json({ nodes: [], edges: [] })
      if (url.includes('/api/review/queue')) return json(queue)
      if (url.includes('/api/suggest')) return json({ query: '', detected: [], suggestions: [] })
      if (url.includes('/api/lookup')) return json({ error: 'No definitions found' }, 404)
      return json({ error: url }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('switches to phrase mode, analyzes on Enter, and keeps the phrase', async () => {
    const user = userEvent.setup()
    renderAt('/')
    const box = await screen.findByRole('combobox', { name: 'Word or phrase to look up' })
    await user.type(box, 'The cat sat.')

    expect(screen.getByRole('button', { name: 'Phrase' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Press Enter or Analyze/)).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(calls('/api/phrase/analyze')).toHaveLength(0)
    expect(calls('/api/lookup')).toHaveLength(0)

    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'The cat sat.' })).toBeInTheDocument()
    expect(String(calls('/api/phrase/analyze')[0]?.[0])).toContain('q=The%20cat%20sat.')
    expect(screen.getByText('Grammar by Claude')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep phrase for recall' }))
    await waitFor(() => expect(calls('/api/phrases')).toHaveLength(1))
    const body = JSON.parse(String(calls('/api/phrases')[0]?.[1]?.body)) as { text: string; lang: string }
    expect(body).toMatchObject({ text: 'The cat sat.', lang: 'en' })
    expect(await screen.findByText('Re-analyze grammar')).toBeInTheDocument()
  })

  it('can force a multi-word query to look up as a word', async () => {
    const user = userEvent.setup()
    renderAt('/')
    const box = await screen.findByRole('combobox', { name: 'Word or phrase to look up' })
    await user.type(box, 'ice cream')
    await user.click(screen.getByRole('button', { name: 'Word' }))
    await waitFor(() => expect(calls('/api/lookup')).toHaveLength(1))
    expect(String(calls('/api/lookup')[0]?.[0])).toContain('q=ice%20cream')
  })

  it('opens shared phrase links straight into the analysis', async () => {
    renderAt('/?q=The%20cat%20sat.&lang=en')
    expect(await screen.findByRole('heading', { name: 'The cat sat.' })).toBeInTheDocument()
  })

  it('quizzes a phrase in review with a cloze card', async () => {
    // The card id seeds which quiz mode comes up; "p0" with no repetitions lands on cloze.
    queue = [phraseWord({ id: 'p0', repetitions: 0 })]
    const user = userEvent.setup()
    renderAt('/review')
    const heading = await screen.findByRole('heading', { level: 1, name: /_____/ })
    const front = heading.parentElement!
    expect(heading).toHaveTextContent('The cat _____.')
    expect(within(front).getByText(/Fill the gap/)).toBeInTheDocument()
    expect(within(front).getByText('(sit · verb)')).toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: /Good/ })).toBeEnabled()
  })
})

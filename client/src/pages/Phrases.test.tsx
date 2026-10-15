import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { I18nProvider } from '../context/I18nContext'
import { LanguageProvider } from '../context/LanguageContext'
import { LexiconProvider } from '../context/LexiconContext'
import { WordTrailProvider } from '../context/WordTrailContext'
import { deviceEntries, phraseEntry, phraseFixture, seedDevice } from '../test/phrase-fixture'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <LanguageProvider>
          <LexiconProvider>
            <WordTrailProvider>
              <App />
            </WordTrailProvider>
          </LexiconProvider>
        </LanguageProvider>
      </I18nProvider>
    </MemoryRouter>,
  )
}

let fetchMock: ReturnType<typeof vi.fn>

function calls(part: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(part))
}

describe('phrases', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/languages')) return json([{ code: 'en', name: 'English', words: 1 }])
      if (url.includes('/api/phrase/analyze')) return json(phraseFixture())
      if (url.includes('/api/legacy/export')) return json({ version: 1, words: [], senses: [], links: [] })
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
    expect(box).toHaveAttribute('autocorrect', 'on')
    expect(box).toHaveAttribute('spellcheck', 'true')
    expect(box).toHaveAttribute('lang', 'en')
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
    expect(await screen.findByText('Re-analyze grammar')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'The cat sat.' })).toBeInTheDocument()
    // Kept on the device, not sent to the server.
    await waitFor(async () => {
      const saved = await deviceEntries()
      expect(saved.map((entry) => entry.displayLemma)).toEqual(['The cat sat.'])
      expect(saved[0]?.kind).toBe('phrase')
    })
    expect(calls('/api/phrases')).toHaveLength(0)

    // Its key words are linked in the entry's atlas list.
    expect(screen.getByRole('link', { name: 'cat' })).toHaveAttribute('href', '/?q=cat&lang=en')
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

  it('explains a missing entry in the app language instead of a raw “Not found”', async () => {
    localStorage.setItem('wordkeep-locale', 'es')
    renderAt('/words/gone')
    expect(await screen.findByRole('heading', { name: 'No se ha encontrado esta entrada.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al léxico' })).toHaveAttribute('href', '/words')
    expect(screen.queryByText('Not found')).toBeNull()
  })

  it('opens shared phrase links straight into the analysis', async () => {
    renderAt('/?q=The%20cat%20sat.&lang=en')
    expect(await screen.findByRole('heading', { name: 'The cat sat.' })).toBeInTheDocument()
  })

  it('words dictionary quiz questions in the app language', async () => {
    localStorage.setItem('wordkeep-locale', 'es')
    const analysis = phraseFixture({
      source: 'dictionary',
      clozeIndexes: [],
      questions: [
        {
          question: 'Which form of “sit” is “sat”?',
          answer: 'simple past (verb)',
          template: { kind: 'form', text: 'sat', lemma: 'sit', partOfSpeech: 'verb', features: ['simple past'] },
        },
      ],
    })
    // "p4" with no repetitions lands on the grammar question (modes: meaning, cloze, grammar).
    await seedDevice([phraseEntry({ id: 'p4', repetitions: 0 }, analysis)])
    const user = userEvent.setup()
    renderAt('/review')
    expect(await screen.findByText('¿Qué forma de «sit» es «sat»?')).toBeInTheDocument()
    expect(screen.getByText(/Pregunta de gramática/)).toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.getByText('simple past (verbo)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bien/ })).toBeEnabled()
  })

  it('quizzes a phrase in review with a cloze card', async () => {
    // The card id seeds which quiz mode comes up; "p0" with no repetitions lands on cloze.
    await seedDevice([phraseEntry({ id: 'p0', repetitions: 0 })])
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

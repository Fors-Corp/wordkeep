import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { I18nProvider } from '../context/I18nContext'
import { LanguageProvider } from '../context/LanguageContext'
import { StatsProvider } from '../context/StatsContext'
import { WordTrailProvider } from '../context/WordTrailContext'
import { phraseFixture } from '../test/phrase-fixture'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <LanguageProvider>
          <StatsProvider>
            <WordTrailProvider>
              <App />
            </WordTrailProvider>
          </StatsProvider>
        </LanguageProvider>
      </I18nProvider>
    </MemoryRouter>,
  )
}

let fetchMock: ReturnType<typeof vi.fn>

describe('app language menu', () => {
  beforeEach(() => {
    localStorage.clear()
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/languages')) {
        return json([
          { code: 'en', name: 'English', words: 1 },
          { code: 'de', name: 'German', words: 1 },
        ])
      }
      if (url.includes('/api/stats')) {
        return json({ dueToday: 1, newCount: 1, lexiconCount: 2, languageCount: 1, phraseCount: 2 })
      }
      if (url.includes('/api/phrase/analyze')) return json(phraseFixture({ language: 'de', notice: { code: 'demo' } }))
      if (url.includes('/api/words')) return json([])
      if (url.includes('/api/suggest')) return json({ query: '', detected: [], suggestions: [] })
      return json({ error: url }, 404)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('switches the whole interface and remembers the choice', async () => {
    const user = userEvent.setup()
    const view = renderApp()
    expect(await screen.findByRole('link', { name: 'Lexicon' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /App language/ }))
    const catalan = screen.getByRole('radio', { name: /Català/ })
    for (const radio of screen.getAllByRole('radio')) {
      const code = radio.getAttribute('lang')!
      expect(radio.querySelector(`svg[data-flag="${code}"]`)).not.toBeNull()
      expect(radio).toHaveTextContent(code)
    }
    expect(screen.getAllByRole('radio')).toHaveLength(7)
    expect(
      screen.getByRole('button', { name: /App language/ }).querySelector('svg[data-flag="en"]'),
    ).not.toBeNull()
    expect(screen.getByRole('radio', { name: /English/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(catalan)

    expect(screen.getByRole('link', { name: 'Lèxic' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Escriu una paraula o una frase/ })).toBeInTheDocument()
    expect(await screen.findByText(/2 frases/)).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ca')
    expect(localStorage.getItem('wordkeep-locale')).toBe('ca')

    view.unmount()
    renderApp()
    expect(await screen.findByRole('link', { name: 'Lèxic' })).toBeInTheDocument()
  })

  it('explains phrases in the app language unless asked to use the phrase language', async () => {
    localStorage.setItem('wordkeep-locale', 'it')
    const user = userEvent.setup()
    renderApp('/?q=Ich%20spreche%20Deutsch&lang=de')
    expect(await screen.findByText('Frase dimostrativa con un’analisi scritta a mano.')).toBeInTheDocument()
    const analyzed = () =>
      fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/api/phrase/analyze'))
    expect(analyzed().at(-1)).toContain('explain=it')

    await user.click(screen.getByRole('button', { name: /Lingua dell’app/ }))
    const toggle = screen.getByRole('switch', { name: /Spiega le frasi nella loro lingua/ })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(analyzed().at(-1)).toContain('explain=de'))
    expect(localStorage.getItem('wordkeep-explain-in-phrase-language')).toBe('1')
  })
})

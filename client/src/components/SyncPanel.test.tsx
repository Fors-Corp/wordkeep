import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { I18nProvider } from '../context/I18nContext'
import { LanguageProvider } from '../context/LanguageContext'
import { LexiconProvider } from '../context/LexiconContext'
import { WordTrailProvider } from '../context/WordTrailContext'
import { deviceEntries } from '../test/phrase-fixture'

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

let syncReply: () => Response

describe('lexicon on the device', () => {
  beforeEach(() => {
    localStorage.clear()
    syncReply = () => json({ error: 'Sync is not set up on this server', code: 'sync-unavailable' }, 503)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/languages')) return json([{ code: 'en', name: 'English', words: 1 }])
        if (url.includes('/api/legacy/export')) return json({ version: 1, words: [], senses: [], links: [] })
        if (url.includes('/api/sync')) return syncReply()
        return json({ error: url }, 404)
      }),
    )
  })

  it('starts empty and offers sample words', async () => {
    const user = userEvent.setup()
    renderAt('/words')
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load sample words' }))
    expect(await screen.findByText('cheerful')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load sample words' })).toBeNull()
    await waitFor(async () => expect((await deviceEntries()).length).toBeGreaterThan(50))
  })

  it('turns sync on with a private code and says when the server has no sync', async () => {
    const user = userEvent.setup()
    renderAt('/words')
    await screen.findByText(/Nothing here yet/)
    await user.click(screen.getByRole('button', { name: 'Turn on sync' }))
    const code = await screen.findByLabelText('Sync code')
    expect(code.textContent).toMatch(/^([A-Z2-7]{4}-){6}[A-Z2-7]{2}$/)
    expect(await screen.findByText(/Sync isn't set up on this server yet/)).toBeInTheDocument()

    vi.stubGlobal('confirm', () => true)
    await user.click(screen.getByRole('button', { name: 'Turn off on this device' }))
    expect(screen.getByRole('button', { name: 'Turn on sync' })).toBeInTheDocument()
  })

  it('joins another device with its code and pulls its entries', async () => {
    const user = userEvent.setup()
    syncReply = () =>
      json({
        cursor: 1,
        more: false,
        changes: [
          {
            id: 'remote-1',
            kind: 'word',
            lemma: 'serendipity',
            displayLemma: 'serendipity',
            language: 'en',
            languageName: 'English',
            phonetic: null,
            etymology: null,
            note: '',
            primarySenseId: null,
            archivedAt: null,
            status: 'new',
            easeFactor: 2.5,
            intervalDays: 0,
            repetitions: 0,
            dueAt: 0,
            lastReviewedAt: null,
            createdAt: 1,
            updatedAt: 1,
            deletedAt: null,
            forms: [],
            senses: [],
            links: [],
            analysis: null,
          },
        ],
      })
    renderAt('/words')
    await screen.findByText(/Nothing here yet/)
    await user.click(screen.getByRole('button', { name: 'I have a code' }))
    const input = screen.getByRole('textbox', { name: 'Sync code' })
    await user.type(input, 'too short')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByText(/doesn't look like a sync code/)).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'abcd-efgh-ijkl-mnop-qrst-uvwx-yz')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByLabelText('Sync code')).toHaveTextContent('ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ')
    expect(await screen.findByRole('link', { name: /serendipity/ })).toBeInTheDocument()
    expect(await screen.findByText(/Up to date/)).toBeInTheDocument()
  })
})

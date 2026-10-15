import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { phraseFixture } from '../test/phrase-fixture'
import { PhraseAnalysisView } from './PhraseAnalysis'

describe('PhraseAnalysisView', () => {
  it('shows the breakdown, meaning, facts, idioms, and clauses', () => {
    render(
      <MemoryRouter>
        <PhraseAnalysisView analysis={phraseFixture()} />
      </MemoryRouter>,
    )
    const strip = screen.getByLabelText('Word-by-word breakdown')
    const sat = within(strip).getByRole('link', { name: /sat/ })
    expect(sat).toHaveAttribute('href', '/?q=sit&lang=en')
    expect(within(sat).getByText('v')).toBeInTheDocument()
    expect(within(sat).getByText('predicate')).toBeInTheDocument()
    expect(within(strip).queryByRole('link', { name: '.' })).toBeNull()

    expect(screen.getByText('El gato se sentó.')).toBeInTheDocument()
    expect(screen.getByText('simple past')).toBeInTheDocument()
    expect(screen.getByText('sat down')).toBeInTheDocument()
    expect(screen.getByText('One clause.')).toBeInTheDocument()
    expect(screen.getByText('← sit')).toBeInTheDocument()
    expect(screen.getByText('The action.')).toBeInTheDocument()
  })

  it('compact mode hides the word list and can render without links', () => {
    render(
      <MemoryRouter>
        <PhraseAnalysisView
          analysis={phraseFixture({ note: 'Dictionary only.' })}
          linked={false}
          compact
          highlight={2}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText('Word by word')).toBeNull()
    expect(screen.getByText('Dictionary only.')).toBeInTheDocument()
  })
})

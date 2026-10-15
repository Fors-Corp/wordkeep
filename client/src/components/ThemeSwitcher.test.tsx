import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from '../context/ThemeContext'
import { ThemeSwitcher } from './ThemeSwitcher'

function Resolved() {
  return <output aria-label="resolved">{useTheme().resolved}</output>
}

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('pins light or dark on <html>, remembers it, and Auto follows the device', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeSwitcher />
        <Resolved />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset.theme).toBeUndefined()

    await user.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('wordkeep-theme')).toBe('dark')
    expect(screen.getByLabelText('resolved')).toHaveTextContent('dark')

    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByLabelText('resolved')).toHaveTextContent('light')

    await user.click(screen.getByRole('button', { name: 'Auto' }))
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('wordkeep-theme')).toBeNull()
  })

  it('restores the saved choice', () => {
    localStorage.setItem('wordkeep-theme', 'dark')
    render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

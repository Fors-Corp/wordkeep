import { NavLink, Outlet } from 'react-router-dom'
import { useStats } from '../context/StatsContext'
import { LanguageSwitcher } from './LanguageSwitcher'
import { WordTrailBar } from './WordTrailBar'

const SUPPORT_URL = 'https://marcfors.com/donate?from=wordkeep'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1.5 text-sm ${
    isActive ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
  }`

export function Layout() {
  const { stats } = useStats()
  const due = stats?.dueToday ?? 0

  return (
    <div className="mx-auto min-h-svh max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-10 flex flex-wrap items-center gap-4 border-b border-rule pb-4">
        <NavLink to="/" className="lemma text-2xl tracking-tight text-ink">
          Wordkeep
        </NavLink>
        <nav className="flex flex-wrap items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            Introduce
          </NavLink>
          <NavLink to="/words" className={linkClass}>
            Lexicon
          </NavLink>
          <NavLink to="/review" className={linkClass}>
            Review{due > 0 ? ` ${due}` : ''}
          </NavLink>
          <NavLink to="/graph" className={linkClass}>
            Atlas
          </NavLink>
          <NavLink to="/discover" className={linkClass}>
            Discover
          </NavLink>
        </nav>
        <div className="ml-auto">
          <LanguageSwitcher />
        </div>
      </header>
      <WordTrailBar />
      <Outlet />
      <footer className="mt-16 border-t border-rule pt-4 text-sm text-muted">
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ink"
        >
          Support · 1,99 €
        </a>
      </footer>
    </div>
  )
}

import { useId, type ReactNode } from 'react'
import type { Locale } from '../i18n'

/**
 * Small flags for the app languages, drawn as SVG so they look the same on
 * every device (Windows shows no flag emoji, and Catalonia has none at all).
 * Simplified: no coats of arms. Decorative, so hidden from screen readers.
 */
function UnionJack() {
  // SVG clip-path references need a plain id; React's ids contain colons or guillemets.
  const id = `uj${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <>
      <clipPath id={`${id}-s`}>
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id={`${id}-t`}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath={`url(#${id}-s)`}>
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${id}-t)`} stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </>
  )
}

const FLAGS: Record<Locale, { viewBox: string; body: () => ReactNode }> = {
  ca: {
    viewBox: '0 0 9 6',
    body: () => (
      <>
        <rect width="9" height="6" fill="#FCDD09" />
        {[1, 3, 5, 7].map((row) => (
          <rect key={row} y={(row * 6) / 9} width="9" height={6 / 9} fill="#DA121A" />
        ))}
      </>
    ),
  },
  es: {
    viewBox: '0 0 3 2',
    body: () => (
      <>
        <rect width="3" height="2" fill="#AA151B" />
        <rect y="0.5" width="3" height="1" fill="#F1BF00" />
      </>
    ),
  },
  pt: {
    viewBox: '0 0 30 20',
    body: () => (
      <>
        <rect width="30" height="20" fill="#DA291C" />
        <rect width="12" height="20" fill="#046A38" />
        <circle cx="12" cy="10" r="4.2" fill="none" stroke="#FFE900" strokeWidth="1.4" />
        <path d="M10 7.6h4v3.6a2 2 0 0 1-4 0z" fill="#fff" stroke="#DA291C" strokeWidth="0.9" />
      </>
    ),
  },
  en: { viewBox: '0 0 60 30', body: () => <UnionJack /> },
  de: {
    viewBox: '0 0 5 3',
    body: () => (
      <>
        <rect width="5" height="3" fill="#000" />
        <rect y="1" width="5" height="1" fill="#DD0000" />
        <rect y="2" width="5" height="1" fill="#FFCE00" />
      </>
    ),
  },
  fr: {
    viewBox: '0 0 3 2',
    body: () => (
      <>
        <rect width="3" height="2" fill="#fff" />
        <rect width="1" height="2" fill="#002654" />
        <rect x="2" width="1" height="2" fill="#CE1126" />
      </>
    ),
  },
  it: {
    viewBox: '0 0 3 2',
    body: () => (
      <>
        <rect width="3" height="2" fill="#fff" />
        <rect width="1" height="2" fill="#009246" />
        <rect x="2" width="1" height="2" fill="#CE2B37" />
      </>
    ),
  },
}

export function Flag({ locale, className = 'h-4 w-6' }: { locale: Locale; className?: string }) {
  const flag = FLAGS[locale]
  const Body = flag.body
  return (
    <svg
      viewBox={flag.viewBox}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-flag={locale}
      className={`shrink-0 overflow-hidden rounded-[3px] ring-1 ring-ink/15 ${className}`}
    >
      <Body />
    </svg>
  )
}

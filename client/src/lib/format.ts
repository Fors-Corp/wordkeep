import { english, type MessageKey, type Translate } from '../i18n'
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'dv', 'ps', 'ug', 'sd', 'ckb', 'arc'])

export function isRtl(code: string): boolean {
  return RTL.has(code.split('-')[0] ?? code)
}

export function nativeLanguageName(code: string, fallback: string, locale = 'en'): string {
  try {
    const name = new Intl.DisplayNames([locale, 'en'], { type: 'language' }).of(code)
    if (name && name !== code) return name
  } catch {
    /* some Wiktionary codes are not ISO */
  }
  return fallback
}

export function languageLine(code: string, name: string, locale = 'en'): string {
  const native = nativeLanguageName(code, name, locale)
  return native === name ? `${name} · ${code}` : `${native} · ${name}`
}

export function formatDue(ts: number, now = Date.now(), t: Translate = english.t, locale?: string): string {
  const delta = ts - now
  if (delta <= 0) return t('due.now')
  const minutes = Math.round(delta / 60_000)
  if (minutes < 60) return t('due.minutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 36) return t('due.hours', { count: hours })
  const days = Math.round(hours / 24)
  if (days < 60) return t('due.days', { count: days })
  return new Date(ts).toLocaleDateString(locale)
}

const STATUSES = ['new', 'learning', 'review', 'mastered'] as const

export function statusLabel(status: string, t: Translate = english.t): string {
  return (STATUSES as readonly string[]).includes(status)
    ? t(`status.${status}` as MessageKey)
    : status
}

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform || ''
  const ua = navigator.userAgent || ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua)
}

export function trailModifierPressed(event: KeyboardEvent): boolean {
  if (isApplePlatform()) return event.ctrlKey && !event.metaKey && !event.altKey
  return event.altKey && !event.ctrlKey && !event.metaKey
}

export function trailModifierLabel(): string {
  return isApplePlatform() ? 'Control' : 'Alt'
}

export function hashHue(input: string): number {
  let hash = 0
  for (const char of input) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

const POS = [
  'noun',
  'proper noun',
  'verb',
  'auxiliary',
  'adjective',
  'adverb',
  'pronoun',
  'determiner',
  'article',
  'preposition',
  'postposition',
  'conjunction',
  'particle',
  'numeral',
  'interjection',
] as const

function knownPos(pos: string): string | null {
  const key = pos.trim().toLowerCase()
  return (POS as readonly string[]).includes(key) ? key : null
}

/** Abbreviation for a part of speech in the app language, e.g. "v" or "adj". */
export function posShort(pos: string, t: Translate = english.t): string {
  const known = knownPos(pos)
  if (known) return t(`posShort.${known}` as MessageKey)
  const key = pos.trim().toLowerCase()
  return key.length > 6 ? key.slice(0, 5) : key
}

/** Full name of a part of speech in the app language. */
export function posLabel(pos: string, t: Translate = english.t): string {
  const known = knownPos(pos)
  return known ? t(`pos.${known}` as MessageKey) : pos
}

/** Tailwind text color for a part of speech, so the breakdown reads at a glance. */
export function posTone(pos: string): string {
  const key = pos.trim().toLowerCase()
  if (key === 'noun' || key === 'proper noun' || key === 'numeral') return 'text-related'
  if (key === 'verb' || key === 'auxiliary') return 'text-accent'
  if (key === 'adjective') return 'text-saved'
  if (key === 'adverb') return 'text-etymology'
  if (key === 'pronoun' || key === 'determiner' || key === 'article') return 'text-gold'
  return 'text-muted'
}

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

export function formatDue(ts: number, now = Date.now()): string {
  const delta = ts - now
  if (delta <= 0) return 'due now'
  const minutes = Math.round(delta / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `in ${hours}h`
  const days = Math.round(hours / 24)
  if (days < 60) return `in ${days}d`
  return new Date(ts).toLocaleDateString()
}

export function statusLabel(status: string): string {
  if (status === 'new') return 'new'
  if (status === 'learning') return 'learning'
  if (status === 'review') return 'review'
  if (status === 'mastered') return 'kept'
  return status
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

/** The reader's language, used for grammar explanations and translations. */
export function explainLanguage(): string {
  const tag = typeof navigator === 'undefined' ? 'en' : navigator.language || 'en'
  return tag.split('-')[0]?.toLowerCase() || 'en'
}

const POS_SHORT: Record<string, string> = {
  noun: 'n',
  'proper noun': 'prop',
  verb: 'v',
  auxiliary: 'aux',
  adjective: 'adj',
  adverb: 'adv',
  pronoun: 'pron',
  determiner: 'det',
  article: 'art',
  preposition: 'prep',
  postposition: 'post',
  conjunction: 'conj',
  particle: 'part',
  numeral: 'num',
  interjection: 'intj',
}

export function posShort(pos: string): string {
  const key = pos.trim().toLowerCase()
  return POS_SHORT[key] ?? (key.length > 6 ? key.slice(0, 5) : key)
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

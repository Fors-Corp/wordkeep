import type { SenseDraft } from '../../shared/types.ts'
import { cleanWiki, etymologyFrom } from './etymology.ts'
import { escapeRegExp, isLangCode } from './params.ts'

const UA = 'Wordkeep/1.0 (personal lexicon; local app)'

const WIKI_EDITION: Record<string, string> = {
  nb: 'no',
  nn: 'no',
  'pt-br': 'pt',
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  'zh-hans': 'zh',
  'zh-hant': 'zh',
}

function wikiLang(code: string): string {
  if (!isLangCode(code)) return 'en'
  const base = (code.split('-')[0] ?? code).toLowerCase()
  return WIKI_EDITION[code.toLowerCase()] ?? WIKI_EDITION[base] ?? base
}

function posFromHeading(heading: string): string {
  const text = heading.replace(/[{}|]/g, ' ').toLowerCase()
  if (/sustant|substantiv|sostant|noun|\bnom\b|\bnomen\b/.test(text)) return 'noun'
  if (/adjet|adject|aggiunt|adjektiv/.test(text)) return 'adjective'
  if (/\bverb/.test(text)) return 'verb'
  if (/adverb/.test(text)) return 'adverb'
  if (/pronoun|pronombre|pronom/.test(text)) return 'pronoun'
  if (/prepos/.test(text)) return 'preposition'
  if (/interjec/.test(text)) return 'interjection'
  if (/conjunc/.test(text)) return 'conjunction'
  if (/article|artikel|articolo/.test(text)) return 'article'
  return ''
}

function isolateSection(wikitext: string, code: string): string {
  const lang = escapeRegExp(code)
  const patterns = [
    new RegExp(`^==\\s*\\{\\{lengua\\|${lang}\\}\\}\\s*==\\s*$`, 'im'),
    new RegExp(`^==\\s*\\{\\{langue\\|${lang}\\}\\}\\s*==\\s*$`, 'im'),
    new RegExp(`^==\\s*\\{\\{lingua\\|${lang}\\}\\}\\s*==\\s*$`, 'im'),
    new RegExp(`^==\\s*\\{\\{-?${lang}-?\\}\\}\\s*==\\s*$`, 'im'),
    /^==[^=]*\{\{Sprache\|[^}]+\}\}[^=]*==\s*$/im,
  ]
  for (const re of patterns) {
    const match = re.exec(wikitext)
    if (!match || match.index === undefined) continue
    const start = match.index + match[0].length
    const rest = wikitext.slice(start)
    const next = rest.search(/^\s*==[^=].*==\s*$/m)
    return next === -1 ? rest : rest.slice(0, next)
  }
  return wikitext
}

function polishDefinition(raw: string): string {
  let text = cleanWiki(raw)
  text = text.replace(/^[\d.;:]+/, '').trim()
  text = text.replace(/^[a-z]{2,12}:\s+/i, '')
  text = text.replace(/\s+/g, ' ').trim()
  if (text.endsWith('.')) text = text.slice(0, -1).trim()
  return text
}

export function parseNativeSenses(wikitext: string, lang: string): SenseDraft[] {
  const section = isolateSection(wikitext, lang)
  const senses: SenseDraft[] = []
  const seen = new Set<string>()
  let pos = ''
  let inBedeutungen = false

  function push(raw: string) {
    const definition = polishDefinition(raw)
    if (definition.length < 8 || definition.length > 420) return
    const key = `${pos}:${definition.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    senses.push({
      partOfSpeech: pos,
      definition,
      examples: [],
      synonyms: [],
      antonyms: [],
      tags: [],
    })
  }

  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim()
    const heading = line.match(/^===+\s*(.+?)\s*===+\s*$/)
    if (heading) {
      const next = posFromHeading(heading[1] ?? '')
      if (next) pos = next
      inBedeutungen = false
      continue
    }
    if (/^\{\{Bedeutungen\}\}/i.test(line)) {
      inBedeutungen = true
      continue
    }
    if (inBedeutungen && /^\{\{[A-ZÄÖÜa-z]/.test(line) && !line.startsWith(':{')) {
      inBedeutungen = false
    }
    if (inBedeutungen) {
      const german = line.match(/^:\s*\[[0-9]+[^\]]*\]\s*(.+)/)
      if (german?.[1]) push(german[1])
      continue
    }
    const spanish = line.match(/^;\s*\d+\s*(.*)$/)
    if (spanish?.[1]) {
      push(spanish[1].replace(/^:\s*/, ''))
      continue
    }
    const hash = line.match(/^#(?![*:])\s*(.+)/)
    if (hash?.[1] && !/\{\{exemple/i.test(hash[1])) push(hash[1])
  }

  return senses.slice(0, 24)
}

export async function fetchNativeWiki(
  word: string,
  lang: string,
): Promise<{ senses: SenseDraft[]; etymology: string | null }> {
  const edition = wikiLang(lang)
  if (!edition || edition === 'en' || edition === 'mul' || edition === 'simple') {
    return { senses: [], etymology: null }
  }

  const body = new URLSearchParams({
    action: 'parse',
    page: word,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
    redirects: '1',
  })

  try {
    const res = await fetch(`https://${edition}.wiktionary.org/w/api.php`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { senses: [], etymology: null }
    const data = (await res.json()) as { parse?: { wikitext?: string } }
    const wikitext = data.parse?.wikitext
    if (!wikitext) return { senses: [], etymology: null }
    const section = isolateSection(wikitext, edition)
    return {
      senses: parseNativeSenses(wikitext, edition),
      etymology: etymologyFrom(section) ?? etymologyFrom(wikitext),
    }
  } catch {
    return { senses: [], etymology: null }
  }
}


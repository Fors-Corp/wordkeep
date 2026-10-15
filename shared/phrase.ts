import type { PhraseAnalysis, PhraseToken } from './types.ts'

export const MAX_PHRASE_WORDS = 40
export const MAX_PHRASE_CHARS = 400

export type Segment = { text: string; start: number; wordLike: boolean }

const FUNCTION_POS = new Set([
  'article',
  'determiner',
  'pronoun',
  'preposition',
  'postposition',
  'conjunction',
  'particle',
  'auxiliary',
  'contraction',
  'punctuation',
])

function segmenter(lang: string): Intl.Segmenter {
  try {
    return new Intl.Segmenter(lang, { granularity: 'word' })
  } catch {
    return new Intl.Segmenter('en', { granularity: 'word' })
  }
}

/** Splits text into words and punctuation, dropping whitespace. */
export function segmentPhrase(text: string, lang: string): Segment[] {
  const out: Segment[] = []
  for (const part of segmenter(lang).segment(text)) {
    if (!part.segment.trim()) continue
    out.push({ text: part.segment, start: part.index, wordLike: Boolean(part.isWordLike) })
  }
  return out
}

export function normalizePhrase(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export function wordCount(text: string, lang: string): number {
  return segmentPhrase(text, lang).filter((part) => part.wordLike).length
}

/** True when the text holds more than one word, so it reads as a phrase. */
export function looksLikePhrase(text: string, lang: string): boolean {
  return wordCount(normalizePhrase(text), lang) > 1
}

export function isContentToken(token: PhraseToken): boolean {
  if (token.punct) return false
  return !FUNCTION_POS.has(token.partOfSpeech.toLowerCase())
}

export type PhraseCard =
  | { mode: 'meaning' }
  | { mode: 'cloze'; tokenIndex: number; prompt: string; answer: string; hint: string }
  | { mode: 'grammar'; question: string; answer: string }

export function clozePrompt(text: string, token: PhraseToken): string {
  const end = token.start + token.text.length
  if (text.slice(token.start, end) !== token.text) return text.replace(token.text, '_____')
  return `${text.slice(0, token.start)}_____${text.slice(end)}`
}

function clozeCandidates(analysis: PhraseAnalysis): PhraseToken[] {
  const words = analysis.tokens.filter((token) => !token.punct)
  if (words.length < 2) return []
  const picked = analysis.clozeIndexes
    .map((index) => analysis.tokens[index])
    .filter((token): token is PhraseToken => Boolean(token && !token.punct))
  if (picked.length) return picked
  const content = words.filter(isContentToken)
  return content.length ? content : words
}

/**
 * Picks how a phrase is quizzed this time. Rotates through meaning recall,
 * cloze and grammar questions so repeated reviews exercise different skills.
 */
export function phraseCardFor(analysis: PhraseAnalysis | null, turn: number): PhraseCard {
  if (!analysis) return { mode: 'meaning' }
  const cloze = clozeCandidates(analysis)
  const modes: PhraseCard['mode'][] = ['meaning']
  if (cloze.length) modes.push('cloze')
  if (analysis.questions.length) modes.push('grammar')
  const step = Math.max(0, Math.floor(turn))
  const mode = modes[step % modes.length]
  const round = Math.floor(step / modes.length)

  if (mode === 'cloze') {
    const token = cloze[round % cloze.length]!
    const hint = [token.lemma && token.lemma !== token.text ? token.lemma : '', token.partOfSpeech]
      .filter(Boolean)
      .join(' · ')
    return {
      mode,
      tokenIndex: token.index,
      prompt: clozePrompt(analysis.text, token),
      answer: token.text,
      hint,
    }
  }
  if (mode === 'grammar') {
    const item = analysis.questions[round % analysis.questions.length]!
    return { mode, question: item.question, answer: item.answer }
  }
  return { mode: 'meaning' }
}

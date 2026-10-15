import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

const DEFAULT_MODEL = 'claude-sonnet-5-5'

const GrammarSchema = z.object({
  translation: z.string(),
  summary: z.string(),
  sentenceType: z.string(),
  tense: z.string(),
  mood: z.string(),
  voice: z.string(),
  tokens: z.array(
    z.object({
      index: z.number().int(),
      lemma: z.string(),
      partOfSpeech: z.string(),
      role: z.string(),
      features: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
  clauses: z.array(z.object({ text: z.string(), type: z.string(), explanation: z.string() })),
  idioms: z.array(z.object({ text: z.string(), meaning: z.string() })),
  questions: z.array(z.object({ question: z.string(), answer: z.string() })),
  clozeIndexes: z.array(z.number().int()),
})

export type ClaudeGrammar = z.infer<typeof GrammarSchema>

export type GrammarRequest = {
  text: string
  languageName: string
  explainIn: string
  tokens: Array<{
    index: number
    text: string
    lemma: string
    partOfSpeech: string
    features: string[]
    gloss: string
  }>
}

type Analyzer = (request: GrammarRequest) => Promise<ClaudeGrammar>

const SYSTEM = `You analyze one phrase or sentence for a language learner's personal lexicon.

Return a grammatical analysis in the requested JSON format:
- tokens: one entry for every numbered word you are given, using the same index. lemma is the dictionary form. partOfSpeech uses lowercase English terms (noun, proper noun, verb, auxiliary, adjective, adverb, pronoun, determiner, article, preposition, postposition, conjunction, particle, numeral, interjection). role is the word's syntactic function in this phrase (subject, predicate, direct object, indirect object, complement, modifier, and so on). features lists its inflection (tense, person, number, case, gender, mood, aspect, degree); leave it empty for uninflected words. explanation is one short sentence on what the word does here.
- translation: a natural translation into the explanation language. If the phrase is already in that language, give a plain paraphrase.
- summary: one to three sentences on how the phrase is built.
- sentenceType: declarative, interrogative, imperative, exclamatory, or fragment, named in the explanation language.
- tense, mood, voice: for the main verb; empty strings when there is no finite verb.
- clauses: each clause with its type (main, relative, subordinate, and so on). Empty for a fragment without a verb.
- idioms: fixed expressions, idioms, phrasal verbs, or collocations whose meaning is not literal.
- questions: three to five short quiz questions about the grammar of this exact phrase, each with a concise answer.
- clozeIndexes: one to four token indexes most worth recalling (key verbs, idioms, tricky inflections). Never punctuation.

The dictionary hints come from an automatic lookup and can be wrong or ambiguous; correct them. Keep partOfSpeech in lowercase English from the list above. Write everything else in the explanation language: roles, features, sentence type, tense, mood, voice, clause types and notes, the summary, the translation, idiom meanings, questions, and answers. Keep grammatical terms short.`

let override: Analyzer | null = null
let client: Anthropic | null = null

/** Replaces the Claude call, for tests. Pass null to restore the real analyzer. */
export function setGrammarAnalyzer(fn: Analyzer | null) {
  override = fn
}

export function claudeConfigured(): boolean {
  if (process.env.WORDKEEP_DISABLE_AI === '1') return false
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim())
}

export function grammarModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL
}

export function grammarAnalyzerActive(): boolean {
  return Boolean(override) || claudeConfigured()
}

function userMessage(request: GrammarRequest): string {
  const lines = request.tokens.map((token) => {
    const hint = [
      token.lemma && token.lemma !== token.text ? `lemma ${token.lemma}` : '',
      token.partOfSpeech,
      token.features.join(', '),
      token.gloss ? `“${token.gloss.slice(0, 90)}”` : '',
    ]
      .filter(Boolean)
      .join('; ')
    return `${token.index}. ${token.text}${hint ? ` (${hint})` : ''}`
  })
  return [
    `Language of the phrase: ${request.languageName}`,
    `Explanation language: ${request.explainIn}`,
    '',
    'Phrase:',
    request.text,
    '',
    'Numbered words with dictionary hints:',
    ...lines,
  ].join('\n')
}

export async function analyzeGrammar(request: GrammarRequest): Promise<ClaudeGrammar> {
  if (override) return override(request)
  client ??= new Anthropic()
  const response = await client.beta.messages.parse(
    {
      model: grammarModel(),
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(GrammarSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: userMessage(request) }],
    },
    { timeout: 90_000 },
  )
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to analyze this phrase')
  if (response.stop_reason === 'max_tokens') throw new Error('Claude’s analysis was cut off')
  if (!response.parsed_output) throw new Error('Claude returned an unreadable analysis')
  return response.parsed_output
}

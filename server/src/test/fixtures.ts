import type { LookupResult } from '../../../shared/types.ts'

export function lookupFixture(overrides: Partial<LookupResult> = {}): LookupResult {
  return {
    lemma: 'happy',
    displayLemma: 'happy',
    language: 'en',
    languageName: 'English',
    phonetic: '/ˈhæpi/',
    etymology: 'From Middle English hap.',
    fallbackFrom: null,
    forms: [{ word: 'happier', tags: ['comparative'] }],
    senses: [
      {
        partOfSpeech: 'adjective',
        definition: 'Feeling or showing pleasure or contentment.',
        examples: ['A happy child.'],
        synonyms: ['glad', 'joyful'],
        antonyms: ['sad'],
        tags: [],
      },
    ],
    translations: [
      { lemma: 'feliz', language: 'es', languageName: 'Spanish' },
      { lemma: 'heureux', language: 'fr', languageName: 'French' },
    ],
    existing: null,
    ...overrides,
  }
}

export function freeDictionaryPayload(word = 'happy') {
  return {
    word,
    entries: [
      {
        language: { code: 'en', name: 'English' },
        partOfSpeech: 'adjective',
        pronunciations: [{ type: 'ipa', text: '/ˈhæpi/' }],
        forms: [{ word: 'happier', tags: ['comparative'] }],
        synonyms: ['glad'],
        antonyms: ['sad'],
        senses: [
          {
            definition: 'Feeling or showing pleasure or contentment.',
            examples: ['A happy child.'],
            synonyms: ['glad', 'joyful'],
            antonyms: ['sad'],
            tags: [],
            translations: [
              { language: { code: 'es', name: 'Spanish' }, word: 'feliz' },
              { language: { code: 'fr', name: 'French' }, word: 'heureux' },
            ],
          },
        ],
      },
    ],
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function installDictionaryMock() {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('freedictionaryapi.com/api/v1/languages')) {
      return jsonResponse([
        { code: 'en', name: 'English', words: 10 },
        { code: 'es', name: 'Spanish', words: 8 },
      ])
    }
    if (url.includes('freedictionaryapi.com/api/v1/entries')) {
      if (url.includes('/missing')) return jsonResponse({}, 404)
      const word = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'happy')
      return jsonResponse(freeDictionaryPayload(word))
    }
    if (url.includes('wiktionary.org')) {
      if (url.includes('es.wiktionary.org')) {
        return jsonResponse({
          parse: {
            wikitext: `== {{lengua|es}} ==\n=== Etimología ===\n{{etimología|la|depressio}}\n=== {{sustantivo femenino|es}} ===\n;1: Definición nativa de prueba.`,
          },
        })
      }
      return jsonResponse({
        parse: {
          wikitext: `==English==\n===Etymology===\nFrom Middle English hap.\n===Adjective===\n# Feeling pleasure.\n{{syn|en|glad}}\n{{ant|en|sad}}\n{{t|es|feliz}}`,
        },
      })
    }
    return original(input, init)
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

type MiniEntry = { pos: string; definitions: string[] }

/** Serves a tiny dictionary keyed by word; anything else is a 404. */
export function installPhraseDictionaryMock(words: Record<string, MiniEntry[]>) {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('freedictionaryapi.com/api/v1/entries')) {
      const word = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? '')
      calls.push(word)
      const entries = words[word]
      if (!entries) return jsonResponse({}, 404)
      return jsonResponse({
        word,
        entries: entries.map((entry) => ({
          language: { code: 'en', name: 'English' },
          partOfSpeech: entry.pos,
          senses: entry.definitions.map((definition) => ({ definition, tags: [] })),
        })),
      })
    }
    if (url.includes('freedictionaryapi.com/api/v1/languages')) {
      return jsonResponse([{ code: 'en', name: 'English', words: 10 }])
    }
    return original(input, init)
  }) as typeof fetch
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

export const PHRASE_WORDS: Record<string, MiniEntry[]> = {
  the: [{ pos: 'article', definitions: ['Definite grammatical article.'] }],
  cat: [{ pos: 'noun', definitions: ['A small domesticated carnivorous mammal.'] }],
  sat: [{ pos: 'verb', definitions: ['simple past and past participle of sit'] }],
  sit: [{ pos: 'verb', definitions: ['To be in a position with the upper body upright.'] }],
  'kick the bucket': [{ pos: 'verb', definitions: ['(idiomatic) To die.'] }],
  kick: [{ pos: 'verb', definitions: ['To strike with the foot.'] }],
  bucket: [{ pos: 'noun', definitions: ['A container for carrying liquids.'] }],
}

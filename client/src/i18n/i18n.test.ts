import { describe, expect, it } from 'vitest'
import { ca } from './ca'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { capitalize, detectLocale, LOCALES, languageNameIn, translator } from './index'
import { it as italian } from './it'
import { pt } from './pt'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe('translations', () => {
  const all = { ca, es, pt, de, fr, it: italian }

  it.each(Object.entries(all))('%s has every key with the same placeholders as English', (_code, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort())
    for (const [key, text] of Object.entries(en)) {
      const translated = messages[key as keyof typeof en]
      expect(translated.trim(), key).not.toBe('')
      expect(placeholders(translated), key).toEqual(placeholders(text))
    }
  })

  it('offers the seven app languages, each named in itself', () => {
    expect(LOCALES.map((item) => item.code)).toEqual(['ca', 'es', 'pt', 'en', 'de', 'fr', 'it'])
    expect(LOCALES.find((item) => item.code === 'ca')?.native).toBe('Català')
  })

  it('detects the first supported browser language', () => {
    expect(detectLocale(['ja-JP', 'ca-ES', 'en'])).toBe('ca')
    expect(detectLocale(['pt-BR'])).toBe('pt')
    expect(detectLocale(['ja'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })

  it('fills placeholders and picks plural forms', () => {
    const { t, tp } = translator('de')
    expect(t('home.notFound', { q: 'Haus' })).toBe('Kein Wörterbucheintrag für „Haus“.')
    expect(tp('home.phrases', 1)).toBe('1 Satz')
    expect(tp('home.phrases', 3)).toBe('3 Sätze')
    expect(translator('fr').tp('home.reviewCards', 0)).toBe('Réviser 0 carte')
  })

  it('names languages in the app language', () => {
    expect(languageNameIn('de', 'es')).toBe('alemán')
    expect(languageNameIn('xx-nope', 'en', 'Mystery')).toBe('Mystery')
    expect(capitalize(languageNameIn('ca', 'ca'), 'ca')).toBe('Català')
  })
})

describe('European Portuguese', () => {
  it('uses the plural for zero and groups large numbers', () => {
    expect(translator('pt').tp('home.reviewCards', 0)).toBe('Rever 0 cartões')
    expect(translator('pt').tp('home.reviewCards', 1)).toBe('Rever 1 cartão')
    expect(translator('de').tp('home.reviewCards', 12000)).toBe('12.000 Karten wiederholen')
  })
})

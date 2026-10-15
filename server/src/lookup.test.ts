import './test/db-env.ts'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { clearLookupCache, lookupWord } from './lookup.ts'
import { fetchNativeWiki } from './native-defs.ts'
import { installDictionaryMock } from './test/fixtures.ts'

describe('lookupWord', () => {
  afterEach(() => {
    clearLookupCache()
  })

  it('returns a structured entry from the dictionary payload', async () => {
    const restore = installDictionaryMock()
    try {
      const result = await lookupWord('happy', 'en')
      assert.ok(result)
      assert.equal(result?.language, 'en')
      assert.equal(result?.displayLemma, 'happy')
      assert.ok((result?.senses.length ?? 0) >= 1)
      assert.match(result?.senses[0]?.definition ?? '', /pleasure|Feeling/)
      assert.ok(result?.translations.some((item) => item.language === 'es'))
    } finally {
      restore()
    }
  })

  it('prefers native-language senses over English glosses', async () => {
    const restore = installDictionaryMock()
    try {
      const result = await lookupWord('depresión', 'es')
      assert.ok(result)
      assert.equal(result?.language, 'es')
      assert.match(result?.senses[0]?.definition ?? '', /Definición nativa/)
      assert.match(result?.etymology ?? '', /depressio/)
    } finally {
      restore()
    }
  })

  it('returns null when the dictionary has no entries', async () => {
    const restore = installDictionaryMock()
    try {
      const result = await lookupWord('missing', 'en')
      assert.equal(result, null)
    } finally {
      restore()
    }
  })

  it('skips native wiktionary for English', async () => {
    assert.deepEqual((await fetchNativeWiki('happy', 'en')).senses, [])
  })
})

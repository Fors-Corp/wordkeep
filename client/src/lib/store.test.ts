import { describe, expect, it } from 'vitest'
import { entryFromLookup } from '@shared/lexicon'
import type { LookupResult } from '@shared/types'
import { openDeviceStore } from './store'

const happy: LookupResult = {
  lemma: 'happy',
  displayLemma: 'happy',
  language: 'en',
  languageName: 'English',
  phonetic: null,
  etymology: null,
  fallbackFrom: null,
  forms: [],
  senses: [{ partOfSpeech: 'adjective', definition: 'Glad.', examples: [], synonyms: [], antonyms: [], tags: [] }],
  translations: [],
  existing: null,
}

/** The database as 2.0.0 left it: unsent ids and sync settings as separate settings. */
function createVersion1(entry: unknown) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('wordkeep', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('entries', { keyPath: 'id' })
      const meta = db.createObjectStore('meta')
      request.transaction!.objectStore('entries').put(entry)
      meta.put(['e-1'], 'dirty')
      meta.put('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'syncKey')
      meta.put(42, 'cursor')
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

describe('device store', () => {
  it('upgrades a 2.0.0 database without losing unsent changes or the sync code', async () => {
    await createVersion1({ ...entryFromLookup(happy, { id: 'e-1', now: 5 }) })
    const store = await openDeviceStore()
    expect(store.persistent).toBe(true)
    expect((await store.loadEntries()).map((entry) => entry.id)).toEqual(['e-1'])
    expect(await store.dirtyIds()).toEqual(['e-1'])
    expect(await store.getSync()).toEqual({ key: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', cursor: 42, lastSyncedAt: null })
    expect(await store.getMeta('syncKey')).toBeUndefined()
  })

  it('keeps a newer local copy when an older one arrives from sync', async () => {
    const store = await openDeviceStore()
    const local = entryFromLookup(happy, { id: 'e-1', now: 2000 })
    await store.writeLocal([local])
    expect(await store.writeRemote([{ ...local, note: 'old', updatedAt: 1000 }])).toEqual([])
    expect(await store.dirtyIds()).toEqual(['e-1'])
    const newer = { ...local, note: 'new', updatedAt: 3000 }
    expect(await store.writeRemote([newer])).toEqual([newer])
    expect(await store.dirtyIds()).toEqual([])
  })
})

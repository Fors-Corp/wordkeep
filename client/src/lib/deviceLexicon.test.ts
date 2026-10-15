import { describe, expect, it, vi } from 'vitest'
import type { StoredEntry } from '@shared/lexicon'
import type { LookupResult } from '@shared/types'
import { phraseFixture } from '../test/phrase-fixture'
import { ApiError } from './api'
import { DeviceLexicon, type SyncFn } from './deviceLexicon'
import { MemoryStore, openDeviceStore } from './store'

function lookup(lemma: string, overrides: Partial<LookupResult> = {}): LookupResult {
  return {
    lemma,
    displayLemma: lemma,
    language: 'en',
    languageName: 'English',
    phonetic: null,
    etymology: null,
    fallbackFrom: null,
    forms: [],
    senses: [
      { partOfSpeech: 'adjective', definition: `Meaning of ${lemma}.`, examples: [], synonyms: [], antonyms: [], tags: [] },
    ],
    translations: [{ lemma: 'feliz', language: 'es', languageName: 'Spanish' }],
    existing: null,
    ...overrides,
  }
}

/** Behaves like POST /api/sync for one sync code: newest copy wins, every accepted write gets the next number. */
function fakeServer() {
  let seq = 0
  const rows = new Map<string, { seq: number; data: string; updatedAt: number }>()
  const sync = vi.fn<SyncFn>(async ({ since, changes }) => {
    for (const entry of changes) {
      const current = rows.get(entry.id)
      if (current && current.updatedAt >= entry.updatedAt) continue
      rows.set(entry.id, { seq: ++seq, data: JSON.stringify(entry), updatedAt: entry.updatedAt })
    }
    const out = [...rows.values()].filter((row) => row.seq > since).sort((a, b) => a.seq - b.seq).slice(0, 500)
    return {
      cursor: out.at(-1)?.seq ?? since,
      changes: out.map((row) => JSON.parse(row.data) as StoredEntry),
      more: out.length === 500,
    }
  })
  return { sync, rows }
}

const offline: SyncFn = async () => {
  throw new Error('offline')
}

describe('device lexicon', () => {
  it('keeps words and phrases on the device and finds them again after a reload', async () => {
    const store = await openDeviceStore()
    const device = await DeviceLexicon.open(store, { sync: offline })
    const word = device.keepLookup(lookup('happy'), { note: 'smile' })
    const phrase = device.keepPhrase(phraseFixture(), 'cats')
    expect(device.keepLookup(lookup('Happy'))).toEqual({ id: word.id, alreadyKept: true })
    device.patch(word.id, { archived: true })
    device.grade(phrase.id, 'good')
    await device.flush()

    const reopened = await DeviceLexicon.open(await openDeviceStore(), { sync: offline })
    const lexicon = reopened.lexicon
    expect(lexicon.detail(word.id)).toMatchObject({ displayLemma: 'happy', note: 'smile' })
    expect(lexicon.detail(word.id)?.archivedAt).not.toBeNull()
    expect(lexicon.detail(phrase.id)).toMatchObject({ kind: 'phrase', note: 'cats', repetitions: 1 })
    expect(lexicon.stats().phraseCount).toBe(1)
  })

  it('deletes with a tombstone so the deletion can reach other devices', async () => {
    const store = new MemoryStore()
    const device = await DeviceLexicon.open(store, { sync: offline })
    const { id } = device.keepLookup(lookup('happy'))
    device.remove(id)
    await device.flush()
    expect(device.lexicon.detail(id)).toBeNull()
    expect((await store.loadEntries())[0]?.deletedAt).not.toBeNull()
    expect(await store.getMeta('dirty')).toEqual([id])
  })

  it('loads the sample words once', async () => {
    const device = await DeviceLexicon.open(new MemoryStore(), { sync: offline })
    const added = device.loadSamples()
    expect(added).toBeGreaterThan(50)
    expect(device.lexicon.stats().phraseCount).toBe(1)
    expect(device.loadSamples()).toBe(0)
    expect(device.lexicon.graph().edges.length).toBeGreaterThan(20)
  })

  it('brings over words from an older server the first time only', async () => {
    const store = new MemoryStore()
    const legacy = vi.fn(async () => ({
      version: 1,
      words: [{ id: 'old-1', lemma: 'cat', display_lemma: 'cat', language: 'en', language_name: 'English', status: 'new' }],
      senses: [],
      links: [],
    }))
    const first = await DeviceLexicon.open(store, { sync: offline, legacy })
    await first.flush()
    expect(first.lexicon.detail('old-1')?.displayLemma).toBe('cat')
    first.remove('old-1')
    await first.flush()
    const second = await DeviceLexicon.open(store, { sync: offline, legacy })
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(second.lexicon.size).toBe(0)
  })

  it('imports a backup it exported, in merge and replace modes', async () => {
    const source = await DeviceLexicon.open(new MemoryStore(), { sync: offline })
    source.keepLookup(lookup('happy'))
    source.keepLookup(lookup('sad'))
    const backup = JSON.parse(JSON.stringify(source.lexicon.backup())) as unknown

    const target = await DeviceLexicon.open(new MemoryStore(), { sync: offline })
    target.keepLookup(lookup('glad'))
    expect(target.importBackup(backup, 'merge')).toBe(2)
    expect(target.lexicon.size).toBe(3)
    expect(target.importBackup(backup, 'replace')).toBe(2)
    expect(target.lexicon.list().map((word) => word.displayLemma)).toEqual(['happy', 'sad'])
    expect(() => target.importBackup({ nope: true }, 'merge')).toThrow('Invalid backup file')
  })
})

describe('sync between devices', () => {
  it('shares keeps, edits, and deletions through one code', async () => {
    const server = fakeServer()
    const phone = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    const laptop = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })

    const happy = phone.keepLookup(lookup('happy'))
    laptop.keepLookup(lookup('sad'))
    const code = await phone.startSync()
    expect(code).toMatch(/^[A-Z2-7]{26}$/)
    expect(phone.sync.status).toBe('ok')

    await laptop.startSync(code.toLowerCase().replace(/(.{4})/g, '$1-'))
    expect(laptop.sync.key).toBe(code)
    await phone.syncNow()
    for (const device of [phone, laptop]) {
      expect(device.lexicon.list().map((word) => word.displayLemma)).toEqual(['happy', 'sad'])
    }

    laptop.patch(happy.id, { note: 'from the laptop' })
    await laptop.syncNow()
    await phone.syncNow()
    expect(phone.lexicon.detail(happy.id)?.note).toBe('from the laptop')

    phone.remove(happy.id)
    await phone.syncNow()
    await laptop.syncNow()
    expect(laptop.lexicon.list().map((word) => word.displayLemma)).toEqual(['sad'])
  })

  it('keeps the newer copy when both devices changed the same entry', async () => {
    const server = fakeServer()
    const a = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    const b = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    const { id } = a.keepLookup(lookup('happy'))
    const code = await a.startSync()
    await b.startSync(code)

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(10_000_000_000_000)
      b.patch(id, { note: 'older' })
      vi.setSystemTime(10_000_000_005_000)
      a.patch(id, { note: 'newer' })
    } finally {
      vi.useRealTimers()
    }
    await a.syncNow()
    await b.syncNow()
    await a.syncNow()
    expect(a.lexicon.detail(id)?.note).toBe('newer')
    expect(b.lexicon.detail(id)?.note).toBe('newer')
  })

  it('pages through large lexicons', async () => {
    const server = fakeServer()
    const big = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    big.importBackup(
      {
        version: 1,
        words: Array.from({ length: 620 }, (_, i) => ({ id: `w${i}`, lemma: `w${i}`, language: 'en', status: 'new' })),
        senses: [],
        links: [],
      },
      'merge',
    )
    const code = await big.startSync()
    expect(server.rows.size).toBe(620)
    const fresh = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    await fresh.startSync(code)
    expect(fresh.lexicon.size).toBe(620)
  })

  it('says when the server has no sync set up, and stops cleanly', async () => {
    const store = new MemoryStore()
    const device = await DeviceLexicon.open(store, {
      sync: async () => {
        throw new ApiError('Sync is not set up on this server', 503, 'sync-unavailable')
      },
    })
    await device.startSync()
    expect(device.sync.status).toBe('unavailable')
    device.stopSync()
    await device.flush()
    expect(device.sync).toMatchObject({ key: null, status: 'off' })
    expect(await store.getMeta('syncKey')).toBeUndefined()
    await expect(device.startSync('not a code')).rejects.toThrow('Invalid sync code')
  })

  it('remembers the code and what is still unsent across reloads', async () => {
    const store = new MemoryStore()
    const device = await DeviceLexicon.open(store, { sync: offline })
    const code = await device.startSync()
    expect(device.sync.status).toBe('error')
    const { id } = device.keepLookup(lookup('happy'))
    await device.flush()

    const server = fakeServer()
    const reopened = await DeviceLexicon.open(store, { sync: server.sync })
    expect(reopened.sync.key).toBe(code)
    await reopened.syncNow()
    expect(server.rows.has(id)).toBe(true)
    expect(await store.getMeta('dirty')).toEqual([])
  })
})

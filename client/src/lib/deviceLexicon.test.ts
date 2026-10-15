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
  let epoch = 'db-1'
  const rows = new Map<string, { seq: number; data: string; updatedAt: number }>()
  const sync = vi.fn<SyncFn>(async ({ since, changes, epoch: known }) => {
    const reset = since > 0 && ((known != null && known !== epoch) || since > seq)
    const lost: StoredEntry[] = []
    for (const entry of changes) {
      const current = rows.get(entry.id)
      if (current && current.updatedAt >= entry.updatedAt) {
        if (current.updatedAt > entry.updatedAt) lost.push(JSON.parse(current.data) as StoredEntry)
        continue
      }
      rows.set(entry.id, { seq: ++seq, data: JSON.stringify(entry), updatedAt: entry.updatedAt })
    }
    if (reset) return { cursor: 0, changes: [], more: false, reset: true, epoch }
    const out = [...rows.values()].filter((row) => row.seq > since).sort((a, b) => a.seq - b.seq).slice(0, 500)
    const pulled = out.map((row) => JSON.parse(row.data) as StoredEntry)
    return {
      cursor: out.at(-1)?.seq ?? since,
      changes: [...pulled, ...lost.filter((entry) => !pulled.some((row) => row.id === entry.id))],
      more: out.length === 500,
      epoch,
    }
  })
  /** The server's store is replaced: nothing in it, numbering starts again. */
  const wipe = () => {
    rows.clear()
    seq = 0
    epoch = `db-${Math.random()}`
  }
  return { sync, rows, wipe }
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
    expect(await store.dirtyIds()).toEqual([id])
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
    expect(await store.getSync()).toBeNull()
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
    expect(await store.dirtyIds()).toEqual([])
  })
})

describe('several tabs on one device', () => {
  it('see each other\'s changes, so an edit in one never undoes a review in another', async () => {
    const tabA = await DeviceLexicon.open(await openDeviceStore(), { sync: offline })
    const tabC = await DeviceLexicon.open(await openDeviceStore(), { sync: offline })
    const { id } = tabA.keepLookup(lookup('happy'))
    await tabA.flush()
    await vi.waitFor(() => expect(tabC.lexicon.detail(id)).not.toBeNull())

    tabC.grade(id, 'easy')
    await tabC.flush()
    await vi.waitFor(() => expect(tabA.lexicon.detail(id)?.repetitions).toBe(1))
    tabA.patch(id, { note: 'smile' })
    await tabA.flush()

    const reopened = await DeviceLexicon.open(await openDeviceStore(), { sync: offline })
    expect(reopened.lexicon.detail(id)).toMatchObject({ note: 'smile', repetitions: 1 })
    for (const tab of [tabA, tabC, reopened]) tab.close()
  })

  it('never lose each other\'s unsent changes', async () => {
    const tabA = await DeviceLexicon.open(await openDeviceStore(), { sync: offline })
    const tabB = await DeviceLexicon.open(await openDeviceStore(), { sync: offline })
    const w = tabB.keepLookup(lookup('happy'))
    await tabB.flush()
    const y = tabA.keepLookup(lookup('sad'))
    await tabA.flush()
    const store = await openDeviceStore()
    expect((await store.dirtyIds()).sort()).toEqual([w.id, y.id].sort())
    tabA.close()
    tabB.close()
  })
})

describe('merging lexicons', () => {
  it('joining a code after loading samples keeps the progress and deletions made elsewhere', async () => {
    const server = fakeServer()
    const first = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    first.loadSamples()
    const happy = first.lexicon.findId('happy', 'en')!
    const glad = first.lexicon.findId('glad', 'en')!
    first.grade(happy, 'good')
    first.remove(glad)
    const code = await first.startSync()

    const second = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    second.loadSamples()
    await second.startSync(code)
    await first.syncNow()

    for (const device of [first, second]) {
      expect(device.lexicon.detail(happy)?.repetitions).toBe(1)
      expect(device.lexicon.detail(glad)).toBeNull()
    }
  })

  it('the same word kept on two devices becomes one entry', async () => {
    const server = fakeServer()
    const phone = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    const laptop = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    phone.keepLookup(lookup('chat', { language: 'fr', languageName: 'French' }))
    laptop.keepLookup(lookup('chat', { language: 'fr', languageName: 'French' }))
    // An entry from before ids came from the word itself.
    laptop.importBackup(
      { version: 1, words: [{ id: 'old-random', lemma: 'cat', language: 'en', status: 'review', repetitions: 3 }], senses: [], links: [] },
      'merge',
    )
    phone.keepLookup(lookup('cat'))
    const code = await phone.startSync()
    await laptop.startSync(code)
    await phone.syncNow()
    for (const device of [phone, laptop]) {
      expect(device.lexicon.list().map((word) => word.displayLemma)).toEqual(['cat', 'chat'])
      expect(device.lexicon.detail('old-random')?.repetitions).toBe(3)
    }
  })

  it('a backup with broken records cannot break the lexicon', async () => {
    const device = await DeviceLexicon.open(new MemoryStore(), { sync: offline })
    device.keepLookup(lookup('happy'))
    const added = device.importBackup(
      {
        version: 2,
        entries: [
          { id: 'x1', displayLemma: 'broken', language: 'en', senses: [{}], links: [{ relation: 'synonym' }] },
          { id: 'x2', displayLemma: '', language: 'en' },
        ],
      },
      'merge',
    )
    expect(added).toBe(1)
    const happy = device.lexicon.findId('happy', 'en')!
    expect(device.lexicon.detail(happy)?.displayLemma).toBe('happy')
    expect(device.lexicon.reviewQueue().length).toBe(2)
    expect(() => device.lexicon.graph()).not.toThrow()
    device.grade('x1', 'good')
    expect(Number.isFinite(device.lexicon.detail('x1')!.dueAt)).toBe(true)
  })
})

describe('sync recovery', () => {
  it('starts over when the server lost its data', async () => {
    const server = fakeServer()
    const phone = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    phone.keepLookup(lookup('happy'))
    const code = await phone.startSync()
    server.wipe()
    // Someone else writes to the fresh store first, so its numbering starts below the phone's cursor.
    const laptop = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    laptop.keepLookup(lookup('sad'))
    await laptop.startSync(code)

    await phone.syncNow()
    expect(phone.lexicon.list().map((word) => word.displayLemma)).toEqual(['happy', 'sad'])
    await laptop.syncNow()
    expect(laptop.lexicon.list().map((word) => word.displayLemma)).toEqual(['happy', 'sad'])
  })

  it('takes the server copy when its own push lost', async () => {
    const server = fakeServer()
    const a = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    const { id } = a.keepLookup(lookup('happy'))
    const code = await a.startSync()
    const b = await DeviceLexicon.open(new MemoryStore(), { sync: server.sync })
    await b.startSync(code)
    // b edits the copy it has with a clock that runs behind a's.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 60_000)
      a.patch(id, { note: 'newer' })
      vi.setSystemTime(1)
      b.patch(id, { note: 'stale' })
    } finally {
      vi.useRealTimers()
    }
    await a.syncNow()
    await b.syncNow()
    expect(b.lexicon.detail(id)?.note).toBe('newer')
  })

  it('switching codes during a sync still syncs the new code', async () => {
    let release: () => void = () => undefined
    const server = fakeServer()
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: SyncFn = async (body) => {
      await gate
      return server.sync(body)
    }
    const device = await DeviceLexicon.open(new MemoryStore(), { sync: slow })
    device.keepLookup(lookup('happy'))
    const first = device.startSync()
    await vi.waitFor(() => expect(device.sync.status).toBe('syncing'))
    device.stopSync()
    const second = device.startSync()
    release()
    await first
    const code = await second
    expect(device.sync).toMatchObject({ key: code, status: 'ok' })
    expect(server.rows.size).toBe(1)
  })

  it('waits before asking a server without sync again', async () => {
    const calls = vi.fn(async () => {
      throw new ApiError('Sync is not set up on this server', 503, 'sync-unavailable')
    })
    const device = await DeviceLexicon.open(new MemoryStore(), { sync: calls })
    await device.startSync()
    expect(device.sync.status).toBe('unavailable')
    await device.syncNow({ auto: true })
    await device.syncNow({ auto: true })
    expect(calls).toHaveBeenCalledTimes(1)
    await device.syncNow()
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('tells the old server only once its words are saved', async () => {
    const legacyAck = vi.fn(async () => ({ ok: true }))
    const legacy = async () => ({
      version: 1,
      words: [{ id: 'old-1', lemma: 'cat', language: 'en', status: 'new' }],
      senses: [],
      links: [],
    })
    const store = new MemoryStore()
    const device = await DeviceLexicon.open(store, { sync: offline, legacy, legacyAck })
    expect(legacyAck).toHaveBeenCalledTimes(1)
    expect((await store.loadEntries()).map((entry) => entry.id)).toEqual(['old-1'])
    expect(device.lexicon.size).toBe(1)

    const empty = vi.fn(async () => ({ ok: true }))
    await DeviceLexicon.open(new MemoryStore(), {
      sync: offline,
      legacy: async () => ({ version: 1, words: [], senses: [], links: [] }),
      legacyAck: empty,
    })
    expect(empty).not.toHaveBeenCalled()
  })
})

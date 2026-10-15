import { sampleEntries } from '@shared/demo'
import {
  duplicateFixes,
  entryFromLookup,
  entryFromPhrase,
  Lexicon,
  normalizeEntry,
  planImport,
  readBackup,
  tombstone,
  withGrade,
  withPatch,
  withPhraseAnalysis,
  type EntryPatch,
  type StoredEntry,
} from '@shared/lexicon'
import { phraseGloss } from '@shared/phrase'
import { createSyncKey, normalizeSyncKey } from '@shared/sync'
import type { Grade, LookupResult, PhraseAnalysis } from '@shared/types'
import { ApiError, type SyncRequest, type SyncResponse } from './api'
import type { DeviceStore } from './store'

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error' | 'unavailable'

export type SyncState = {
  key: string | null
  status: SyncStatus
  lastSyncedAt: number | null
  error: unknown
}

export type SyncFn = (body: SyncRequest) => Promise<SyncResponse>

type Message = { type: 'entries'; ids: string[] } | { type: 'sync' }

const PUSH_BATCH = 200
/** While the server has no sync, automatic attempts wait this long between tries. */
const UNAVAILABLE_RETRY_MS = 10 * 60 * 1000
const MAX_ROUNDS = 200

/**
 * The reader's lexicon on this device. Every change is applied in memory at
 * once and written to the device store in one transaction with its "not yet
 * sent" mark. Other tabs are told on a BroadcastChannel and reload what
 * changed. When sync is on, unsent records go to the server and newer
 * records from other devices come back (the newest `updatedAt` wins); one
 * tab at a time does this, under a Web Lock where the browser has them.
 */
export class DeviceLexicon {
  private readonly store: DeviceStore
  private readonly syncFn: SyncFn
  private readonly records = new Map<string, StoredEntry>()
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly channel: BroadcastChannel | null
  private syncing: Promise<void> | null = null
  private syncAgain = false
  private lastAttemptAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private cached: Lexicon | null = null
  sync: SyncState = { key: null, status: 'off', lastSyncedAt: null, error: null }
  /** The last error writing to the device, until a write succeeds again. */
  storageError: unknown = null

  private constructor(store: DeviceStore, syncFn: SyncFn) {
    this.store = store
    this.syncFn = syncFn
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(store.channel)
    if (this.channel) this.channel.onmessage = (event: MessageEvent<Message>) => void this.receive(event.data)
  }

  static async open(
    store: DeviceStore,
    options: { sync: SyncFn; legacy?: () => Promise<unknown>; legacyAck?: () => Promise<unknown> },
  ): Promise<DeviceLexicon> {
    const device = new DeviceLexicon(store, options.sync)
    for (const entry of await store.loadEntries()) device.records.set(entry.id, entry)
    const meta = await store.getSync()
    device.sync = {
      key: meta?.key ?? null,
      status: meta ? 'idle' : 'off',
      lastSyncedAt: meta?.lastSyncedAt ?? null,
      error: null,
    }
    if (options.legacy && device.records.size === 0 && !(await store.getMeta('legacyChecked'))) {
      await device.migrateLegacy(options.legacy, options.legacyAck)
    }
    device.mergeDuplicates()
    return device
  }

  /**
   * Brings over words an older self-hosted server kept, the first time this
   * device opens. The server is told only once they are safely saved here.
   */
  private async migrateLegacy(fetchLegacy: () => Promise<unknown>, ack?: () => Promise<unknown>) {
    try {
      const entries = readBackup(await fetchLegacy())
      if (entries.length) {
        await this.store.writeLocal(entries)
        for (const entry of entries) this.records.set(entry.id, entry)
        this.recordsChanged()
      }
      await this.store.setMeta('legacyChecked', true)
      if (entries.length) await ack?.().catch(() => undefined)
    } catch {
      /* try again next time */
    }
  }

  get persistent() {
    return this.store.persistent
  }

  get lexicon(): Lexicon {
    this.cached ??= new Lexicon(this.records.values())
    return this.cached
  }

  /** Every record, deleted ones included. */
  all(): StoredEntry[] {
    return [...this.records.values()]
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  private recordsChanged() {
    this.cached = null
    this.notify()
  }

  /** Stops listening to other tabs and cancels a scheduled sync. */
  close() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.channel?.close()
  }

  private announce(message: Message) {
    try {
      this.channel?.postMessage(message)
    } catch {
      /* channel closed */
    }
  }

  /** Another tab changed records or sync settings: reload them from the store. */
  private async receive(message: Message) {
    if (message.type === 'entries') {
      const fresh = await this.store.getEntries(message.ids)
      // Keep this tab's own newer copy while its write is still on the way.
      const newer = fresh.filter((entry) => (this.records.get(entry.id)?.updatedAt ?? -1) <= entry.updatedAt)
      if (!newer.length) return
      for (const entry of newer) this.records.set(entry.id, entry)
      this.recordsChanged()
    } else {
      const meta = await this.store.getSync()
      if ((meta?.key ?? null) === this.sync.key) return
      this.setSync({ key: meta?.key ?? null, status: meta ? 'idle' : 'off', error: null, lastSyncedAt: null })
    }
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    void promise.finally(() => this.pending.delete(promise)).catch(() => undefined)
    return promise
  }

  /** Resolves once everything changed so far is written to the device. */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  private write(entries: StoredEntry[]) {
    if (!entries.length) return
    for (const entry of entries) this.records.set(entry.id, entry)
    this.recordsChanged()
    const ids = entries.map((entry) => entry.id)
    void this.track(
      this.store.writeLocal(entries).then(
        () => {
          if (this.storageError) {
            this.storageError = null
            this.notify()
          }
          this.announce({ type: 'entries', ids })
        },
        (error: unknown) => {
          console.warn('Wordkeep could not save to this device', error)
          this.storageError = error
          this.notify()
        },
      ),
    )
    this.scheduleSync()
  }

  private current(id: string): StoredEntry | null {
    const entry = this.records.get(id)
    return entry && !entry.deletedAt ? entry : null
  }

  /** A new record must be newer than a deleted record it brings back. */
  private revive(entry: StoredEntry): StoredEntry {
    const previous = this.records.get(entry.id)
    return previous ? { ...entry, updatedAt: Math.max(entry.updatedAt, previous.updatedAt + 1) } : entry
  }

  keepLookup(lookup: LookupResult, options: { note?: string; primarySenseIndex?: number } = {}) {
    const existing = this.lexicon.findId(lookup.displayLemma, lookup.language)
    if (existing) return { id: existing, alreadyKept: true }
    const entry = this.revive(entryFromLookup(lookup, options))
    this.write([entry])
    return { id: entry.id, alreadyKept: false }
  }

  keepPhrase(analysis: PhraseAnalysis, note = '') {
    const existing = this.lexicon.findId(analysis.text, analysis.language)
    if (existing) return { id: existing, alreadyKept: true }
    const entry = this.revive(entryFromPhrase(analysis, phraseGloss(analysis), { note }))
    this.write([entry])
    return { id: entry.id, alreadyKept: false }
  }

  patch(id: string, patch: EntryPatch) {
    const entry = this.current(id)
    if (entry) this.write([withPatch(entry, patch)])
  }

  grade(id: string, grade: Grade) {
    const entry = this.current(id)
    if (entry) this.write([withGrade(entry, grade)])
  }

  reanalyze(id: string, analysis: PhraseAnalysis) {
    const entry = this.current(id)
    if (entry) this.write([withPhraseAnalysis(entry, analysis, phraseGloss(analysis))])
  }

  remove(id: string) {
    const entry = this.current(id)
    if (entry) this.write([tombstone(entry)])
  }

  /** Reads a backup file (either format) into the lexicon; returns how many records it added. */
  importBackup(raw: unknown, mode: 'merge' | 'replace'): number {
    const planned = planImport(this.all(), readBackup(raw), mode)
    this.write(planned)
    return planned.filter((entry) => !entry.deletedAt).length
  }

  loadSamples(): number {
    const planned = planImport(this.all(), sampleEntries(), 'merge')
    this.write(planned)
    return planned.length
  }

  /** Two live records for the same word become one. */
  private mergeDuplicates(): boolean {
    const fixes = duplicateFixes(this.records.values())
    this.write(fixes)
    return fixes.length > 0
  }

  /* ---------------------------------------------------------------- */
  /* Sync                                                              */

  private setSync(next: Partial<SyncState>) {
    this.sync = { ...this.sync, ...next }
    this.notify()
  }

  /** Turns sync on with a new code, or joins the lexicon behind an existing one. */
  async startSync(code?: string): Promise<string> {
    const key = code === undefined ? createSyncKey() : normalizeSyncKey(code)
    if (!key) throw new Error('Invalid sync code')
    await this.syncing?.catch(() => undefined)
    await this.flush()
    await this.store.setSync({ key, cursor: 0, lastSyncedAt: null })
    await this.store.markAllDirty()
    this.announce({ type: 'sync' })
    this.setSync({ key, status: 'idle', error: null, lastSyncedAt: null })
    await this.syncNow()
    return key
  }

  stopSync() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    void this.track(this.store.setSync(null).then(() => this.announce({ type: 'sync' })))
    this.setSync({ key: null, status: 'off', error: null, lastSyncedAt: null })
  }

  scheduleSync(delay = 1500) {
    if (!this.sync.key) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.syncNow()
    }, delay)
  }

  /**
   * Sends unsent records and fetches newer ones. `auto` marks a background
   * attempt (timer, tab focus), which waits a while after the server said it
   * has no sync instead of asking again every minute.
   */
  syncNow(options: { auto?: boolean } = {}): Promise<void> {
    if (!this.sync.key) return Promise.resolve()
    if (options.auto && this.sync.status === 'unavailable' && Date.now() - this.lastAttemptAt < UNAVAILABLE_RETRY_MS) {
      return Promise.resolve()
    }
    if (this.syncing) {
      this.syncAgain = true
      return this.syncing
    }
    this.syncAgain = false
    this.syncing = this.exclusive(() => this.runSync()).finally(() => {
      this.syncing = null
      // A request that came in while the last run was ending (or switching codes).
      if (this.syncAgain && this.sync.key) void this.syncNow()
    })
    return this.syncing
  }

  /** One tab syncs at a time; the others wait their turn. */
  private exclusive(task: () => Promise<void>): Promise<void> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks?.request) return task()
    return locks.request('wordkeep-sync', task) as Promise<void>
  }

  private async runSync() {
    await this.flush()
    const meta = await this.store.getSync()
    if (!meta) {
      if (this.sync.key) this.setSync({ key: null, status: 'off', error: null, lastSyncedAt: null })
      return
    }
    const key = meta.key
    if (key !== this.sync.key) this.setSync({ key, lastSyncedAt: meta.lastSyncedAt })
    this.lastAttemptAt = Date.now()
    this.setSync({ status: 'syncing' })
    let cursor = meta.cursor
    let epoch = meta.epoch ?? null
    let resets = 0
    let rounds = 0
    try {
      do {
        this.syncAgain = false
        for (;;) {
          if ((rounds += 1) > MAX_ROUNDS) throw new Error('Sync did not settle')
          const ids = (await this.store.dirtyIds()).slice(0, PUSH_BATCH)
          const batch = await this.store.getEntries(ids)
          const response = await this.syncFn({ key, since: cursor, changes: batch, epoch })
          if (this.sync.key !== key) return
          epoch = response.epoch ?? epoch
          // Sent records are done unless they changed again while the request was out.
          await this.store.markSent(batch.map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt })))
          if (response.reset) {
            // The server's store was replaced: send everything again and read from the start.
            if ((resets += 1) > 1) throw new Error('Sync keeps starting over')
            cursor = 0
            await this.store.markAllDirty()
            await this.store.updateSync(key, { cursor, epoch })
            continue
          }
          const incoming = response.changes
            .map(normalizeEntry)
            .filter((entry): entry is StoredEntry => entry !== null)
          const saved = await this.store.writeRemote(incoming)
          if (saved.length) {
            for (const entry of saved) this.records.set(entry.id, entry)
            this.recordsChanged()
            this.announce({ type: 'entries', ids: saved.map((entry) => entry.id) })
          }
          cursor = response.cursor
          await this.store.updateSync(key, { cursor, epoch })
          if (ids.length < PUSH_BATCH && !response.more) break
        }
        // The same word kept on two devices: merge, and send the merge right away.
        if (this.mergeDuplicates()) {
          await this.flush()
          this.syncAgain = true
        }
      } while (this.syncAgain)
      const now = Date.now()
      await this.store.updateSync(key, { lastSyncedAt: now })
      this.setSync({ status: 'ok', lastSyncedAt: now, error: null })
    } catch (error) {
      if (this.sync.key !== key) return
      const unavailable = error instanceof ApiError && error.code === 'sync-unavailable'
      this.setSync({ status: unavailable ? 'unavailable' : 'error', error })
    }
  }
}

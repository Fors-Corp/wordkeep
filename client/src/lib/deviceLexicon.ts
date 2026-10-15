import { sampleEntries } from '@shared/demo'
import {
  entryFromLookup,
  entryFromPhrase,
  Lexicon,
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
import { ApiError, type SyncResponse } from './api'
import type { DeviceStore } from './store'

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error' | 'unavailable'

export type SyncState = {
  key: string | null
  status: SyncStatus
  lastSyncedAt: number | null
  error: unknown
}

export type SyncFn = (body: { key: string; since: number; changes: StoredEntry[] }) => Promise<SyncResponse>

const PUSH_BATCH = 200

/**
 * The reader's lexicon on this device. Every change is applied in memory at
 * once, then written to the device store; when sync is on, changed records
 * are also sent to the server and newer records from other devices merged in
 * (the newest `updatedAt` wins).
 */
export class DeviceLexicon {
  private readonly store: DeviceStore
  private readonly syncFn: SyncFn
  private readonly records = new Map<string, StoredEntry>()
  private dirty = new Set<string>()
  private cursor = 0
  private listeners = new Set<() => void>()
  private saving: Promise<void> = Promise.resolve()
  private syncing: Promise<void> | null = null
  private syncAgain = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private cached: Lexicon | null = null
  sync: SyncState = { key: null, status: 'off', lastSyncedAt: null, error: null }

  private constructor(store: DeviceStore, syncFn: SyncFn) {
    this.store = store
    this.syncFn = syncFn
  }

  static async open(
    store: DeviceStore,
    options: { sync: SyncFn; legacy?: () => Promise<unknown> },
  ): Promise<DeviceLexicon> {
    const device = new DeviceLexicon(store, options.sync)
    for (const entry of await store.loadEntries()) device.records.set(entry.id, entry)
    device.dirty = new Set((await store.getMeta<string[]>('dirty')) ?? [])
    device.cursor = (await store.getMeta<number>('cursor')) ?? 0
    const key = (await store.getMeta<string>('syncKey')) ?? null
    const lastSyncedAt = (await store.getMeta<number>('lastSyncedAt')) ?? null
    device.sync = { key, status: key ? 'idle' : 'off', lastSyncedAt, error: null }
    if (options.legacy && device.records.size === 0 && !(await store.getMeta('legacyChecked'))) {
      await device.migrateLegacy(options.legacy)
    }
    return device
  }

  /** Brings over words an older self-hosted server kept, the first time this device opens. */
  private async migrateLegacy(fetchLegacy: () => Promise<unknown>) {
    try {
      const raw = await fetchLegacy()
      const entries = readBackup(raw)
      if (entries.length) this.write(entries)
      await this.store.setMeta('legacyChecked', true)
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

  private changed() {
    this.cached = null
    for (const listener of this.listeners) listener()
  }

  private persist(task: () => Promise<void>) {
    this.saving = this.saving.then(task).catch((error: unknown) => {
      console.warn('Wordkeep could not save to this device', error)
    })
  }

  /** Resolves once everything changed so far is written to the device. */
  flush(): Promise<void> {
    return this.saving
  }

  private write(entries: StoredEntry[]) {
    if (!entries.length) return
    for (const entry of entries) {
      this.records.set(entry.id, entry)
      this.dirty.add(entry.id)
    }
    const dirty = [...this.dirty]
    this.persist(async () => {
      await this.store.putEntries(entries)
      await this.store.setMeta('dirty', dirty)
    })
    this.changed()
    this.scheduleSync()
  }

  private current(id: string): StoredEntry | null {
    const entry = this.records.get(id)
    return entry && !entry.deletedAt ? entry : null
  }

  keepLookup(lookup: LookupResult, options: { note?: string; primarySenseIndex?: number } = {}) {
    const existing = this.lexicon.findId(lookup.displayLemma, lookup.language)
    if (existing) return { id: existing, alreadyKept: true }
    const entry = entryFromLookup(lookup, options)
    this.write([entry])
    return { id: entry.id, alreadyKept: false }
  }

  keepPhrase(analysis: PhraseAnalysis, note = '') {
    const existing = this.lexicon.findId(analysis.text, analysis.language)
    if (existing) return { id: existing, alreadyKept: true }
    const entry = entryFromPhrase(analysis, phraseGloss(analysis), { note })
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

  /* ---------------------------------------------------------------- */
  /* Sync                                                              */

  private setSync(next: Partial<SyncState>) {
    this.sync = { ...this.sync, ...next }
    this.changed()
  }

  /** Turns sync on with a new code, or joins the lexicon behind an existing one. */
  async startSync(code?: string): Promise<string> {
    const key = code === undefined ? createSyncKey() : normalizeSyncKey(code)
    if (!key) throw new Error('Invalid sync code')
    this.cursor = 0
    this.dirty = new Set(this.records.keys())
    const dirty = [...this.dirty]
    this.persist(async () => {
      await this.store.setMeta('syncKey', key)
      await this.store.setMeta('cursor', 0)
      await this.store.setMeta('dirty', dirty)
    })
    this.setSync({ key, status: 'idle', error: null, lastSyncedAt: null })
    await this.syncNow()
    return key
  }

  stopSync() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.cursor = 0
    this.persist(async () => {
      await this.store.setMeta('syncKey', undefined)
      await this.store.setMeta('cursor', 0)
      await this.store.setMeta('lastSyncedAt', undefined)
    })
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

  /** Records from another device that are newer than ours replace ours. */
  private applyRemote(changes: StoredEntry[]) {
    const accepted: StoredEntry[] = []
    for (const incoming of changes) {
      const local = this.records.get(incoming.id)
      if (local && local.updatedAt >= incoming.updatedAt) continue
      const entry = { ...incoming, deletedAt: incoming.deletedAt ?? null }
      this.records.set(entry.id, entry)
      this.dirty.delete(entry.id)
      accepted.push(entry)
    }
    if (accepted.length) {
      this.persist(() => this.store.putEntries(accepted))
      this.changed()
    }
  }

  syncNow(): Promise<void> {
    if (!this.sync.key) return Promise.resolve()
    if (this.syncing) {
      this.syncAgain = true
      return this.syncing
    }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async runSync() {
    const key = this.sync.key
    if (!key) return
    this.setSync({ status: 'syncing' })
    try {
      do {
        this.syncAgain = false
        const pending = [...this.dirty]
        for (;;) {
          const batch = pending
            .splice(0, PUSH_BATCH)
            .map((id) => this.records.get(id))
            .filter((entry): entry is StoredEntry => Boolean(entry))
          const response = await this.syncFn({ key, since: this.cursor, changes: batch })
          if (this.sync.key !== key) return
          // Sent records are done unless they changed again while the request was out.
          for (const entry of batch) {
            if (this.records.get(entry.id)?.updatedAt === entry.updatedAt) this.dirty.delete(entry.id)
          }
          this.applyRemote(response.changes)
          this.cursor = response.cursor
          const cursor = this.cursor
          const dirty = [...this.dirty]
          this.persist(async () => {
            await this.store.setMeta('cursor', cursor)
            await this.store.setMeta('dirty', dirty)
          })
          if (!pending.length && !response.more) break
        }
      } while (this.syncAgain)
      const now = Date.now()
      this.persist(() => this.store.setMeta('lastSyncedAt', now))
      this.setSync({ status: 'ok', lastSyncedAt: now, error: null })
    } catch (error) {
      if (this.sync.key !== key) return
      const unavailable = error instanceof ApiError && error.code === 'sync-unavailable'
      this.setSync({ status: unavailable ? 'unavailable' : 'error', error })
    }
  }
}

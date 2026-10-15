import { normalizeEntry, type StoredEntry } from '@shared/lexicon'

/** Which sync code this device uses, and how far it has read that code's changes. */
export type SyncMeta = {
  key: string
  cursor: number
  lastSyncedAt: number | null
  /** Which server database the cursor counts in. */
  epoch?: string | null
}

/**
 * Where the lexicon lives on this device: IndexedDB, with one record per word
 * or phrase, the ids not yet sent to sync, and a few settings. Every write is
 * one transaction, so a record and its "not yet sent" mark are saved
 * together. Several tabs can share it: each change is announced on a
 * BroadcastChannel so the other tabs reload it.
 * Falls back to memory when the browser refuses storage (some private modes).
 */
export interface DeviceStore {
  readonly persistent: boolean
  /** Name of the channel that tabs sharing this store talk on. */
  readonly channel: string
  loadEntries(): Promise<StoredEntry[]>
  getEntries(ids: string[]): Promise<StoredEntry[]>
  /** Saves records this device changed, marked as not yet sent. */
  writeLocal(entries: StoredEntry[]): Promise<void>
  /**
   * Saves records from another device, but only those newer than the stored
   * copy (checked inside the transaction, so a newer local edit made in
   * another tab is never overwritten). Returns the ones it saved.
   */
  writeRemote(entries: StoredEntry[]): Promise<StoredEntry[]>
  dirtyIds(): Promise<string[]>
  /** Clears the "not yet sent" mark of records still exactly as they were sent. */
  markSent(sent: Array<{ id: string; updatedAt: number }>): Promise<void>
  markAllDirty(): Promise<void>
  getSync(): Promise<SyncMeta | null>
  setSync(meta: SyncMeta | null): Promise<void>
  /** Updates the cursor only if this device still syncs with `key`. */
  updateSync(key: string, patch: Partial<Omit<SyncMeta, 'key'>>): Promise<void>
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
}

const DB_NAME = 'wordkeep'
const VERSION = 2

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'))
  })
}

function clean(raw: unknown[]): StoredEntry[] {
  return raw.map(normalizeEntry).filter((entry): entry is StoredEntry => entry !== null)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction!
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('dirty')) db.createObjectStore('dirty')
      if (event.oldVersion === 1) {
        // 2.0.0 kept the unsent ids, sync code and cursor as separate settings.
        // Plain callbacks: the upgrade transaction must still be active for the writes.
        const meta = tx.objectStore('meta')
        const dirty = tx.objectStore('dirty')
        const names = ['dirty', 'syncKey', 'cursor', 'lastSyncedAt']
        const values: Record<string, unknown> = {}
        let pending = names.length
        for (const name of names) {
          const request = meta.get(name)
          request.onsuccess = () => {
            values[name] = request.result
            if ((pending -= 1) > 0) return
            const ids = values.dirty
            for (const id of Array.isArray(ids) ? ids : []) if (typeof id === 'string') dirty.put(true, id)
            if (typeof values.syncKey === 'string') {
              const cursor = typeof values.cursor === 'number' ? values.cursor : 0
              const last = typeof values.lastSyncedAt === 'number' ? values.lastSyncedAt : null
              meta.put({ key: values.syncKey, cursor, lastSyncedAt: last }, 'sync')
            }
            for (const old of names) meta.delete(old)
          }
        }
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // Another tab upgrading the database asks this one to let go.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => reject(request.error)
    // A tab still running an older Wordkeep holds the database open. Wait for
    // it to reload or close rather than falling back to an empty, unsaved lexicon.
    request.onblocked = () => console.warn('Wordkeep is waiting for another tab to reload')
  })
}

class IndexedDbStore implements DeviceStore {
  readonly persistent = true
  readonly channel = 'wordkeep-device'
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  async loadEntries(): Promise<StoredEntry[]> {
    const tx = this.db.transaction('entries', 'readonly')
    return clean(await done(tx.objectStore('entries').getAll()))
  }

  async getEntries(ids: string[]): Promise<StoredEntry[]> {
    if (!ids.length) return []
    const tx = this.db.transaction('entries', 'readonly')
    const store = tx.objectStore('entries')
    return clean(await Promise.all(ids.map((id) => done(store.get(id)))))
  }

  async writeLocal(entries: StoredEntry[]): Promise<void> {
    if (!entries.length) return
    const tx = this.db.transaction(['entries', 'dirty'], 'readwrite')
    const store = tx.objectStore('entries')
    const dirty = tx.objectStore('dirty')
    for (const entry of entries) {
      store.put(entry)
      dirty.put(true, entry.id)
    }
    await finished(tx)
  }

  async writeRemote(entries: StoredEntry[]): Promise<StoredEntry[]> {
    if (!entries.length) return []
    const tx = this.db.transaction(['entries', 'dirty'], 'readwrite')
    const store = tx.objectStore('entries')
    const dirty = tx.objectStore('dirty')
    const saved: StoredEntry[] = []
    for (const entry of entries) {
      const request = store.get(entry.id)
      request.onsuccess = () => {
        const local = request.result as StoredEntry | undefined
        if (local && local.updatedAt >= entry.updatedAt) return
        store.put(entry)
        dirty.delete(entry.id)
        saved.push(entry)
      }
    }
    await finished(tx)
    return saved
  }

  async dirtyIds(): Promise<string[]> {
    const tx = this.db.transaction('dirty', 'readonly')
    return (await done(tx.objectStore('dirty').getAllKeys())).map(String)
  }

  async markSent(sent: Array<{ id: string; updatedAt: number }>): Promise<void> {
    if (!sent.length) return
    const tx = this.db.transaction(['entries', 'dirty'], 'readwrite')
    const store = tx.objectStore('entries')
    const dirty = tx.objectStore('dirty')
    for (const item of sent) {
      const request = store.get(item.id)
      request.onsuccess = () => {
        const local = request.result as StoredEntry | undefined
        if (!local || local.updatedAt === item.updatedAt) dirty.delete(item.id)
      }
    }
    await finished(tx)
  }

  async markAllDirty(): Promise<void> {
    const tx = this.db.transaction(['entries', 'dirty'], 'readwrite')
    const dirty = tx.objectStore('dirty')
    const keys = tx.objectStore('entries').getAllKeys()
    keys.onsuccess = () => {
      for (const id of keys.result) dirty.put(true, id)
    }
    await finished(tx)
  }

  async getSync(): Promise<SyncMeta | null> {
    return ((await this.getMeta<SyncMeta>('sync')) ?? null) as SyncMeta | null
  }

  async setSync(meta: SyncMeta | null): Promise<void> {
    await this.setMeta('sync', meta ?? undefined)
  }

  async updateSync(key: string, patch: Partial<Omit<SyncMeta, 'key'>>): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite')
    const meta = tx.objectStore('meta')
    const request = meta.get('sync')
    request.onsuccess = () => {
      const current = request.result as SyncMeta | undefined
      if (current?.key === key) meta.put({ ...current, ...patch }, 'sync')
    }
    await finished(tx)
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction('meta', 'readonly')
    return (await done(tx.objectStore('meta').get(key))) as T | undefined
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite')
    if (value === undefined) tx.objectStore('meta').delete(key)
    else tx.objectStore('meta').put(value, key)
    await finished(tx)
  }
}

let memoryStores = 0

export class MemoryStore implements DeviceStore {
  readonly persistent = false
  readonly channel = `wordkeep-memory-${(memoryStores += 1)}-${Math.random().toString(36).slice(2)}`
  private readonly entries = new Map<string, StoredEntry>()
  private readonly dirty = new Set<string>()
  private readonly meta = new Map<string, unknown>()

  async loadEntries() {
    return [...this.entries.values()]
  }

  async getEntries(ids: string[]) {
    return ids.map((id) => this.entries.get(id)).filter((entry): entry is StoredEntry => Boolean(entry))
  }

  async writeLocal(entries: StoredEntry[]) {
    for (const entry of entries) {
      this.entries.set(entry.id, entry)
      this.dirty.add(entry.id)
    }
  }

  async writeRemote(entries: StoredEntry[]) {
    const saved: StoredEntry[] = []
    for (const entry of entries) {
      const local = this.entries.get(entry.id)
      if (local && local.updatedAt >= entry.updatedAt) continue
      this.entries.set(entry.id, entry)
      this.dirty.delete(entry.id)
      saved.push(entry)
    }
    return saved
  }

  async dirtyIds() {
    return [...this.dirty]
  }

  async markSent(sent: Array<{ id: string; updatedAt: number }>) {
    for (const item of sent) {
      const local = this.entries.get(item.id)
      if (!local || local.updatedAt === item.updatedAt) this.dirty.delete(item.id)
    }
  }

  async markAllDirty() {
    for (const id of this.entries.keys()) this.dirty.add(id)
  }

  async getSync() {
    return (this.meta.get('sync') as SyncMeta | undefined) ?? null
  }

  async setSync(meta: SyncMeta | null) {
    if (meta) this.meta.set('sync', meta)
    else this.meta.delete('sync')
  }

  async updateSync(key: string, patch: Partial<Omit<SyncMeta, 'key'>>) {
    const current = this.meta.get('sync') as SyncMeta | undefined
    if (current?.key === key) this.meta.set('sync', { ...current, ...patch })
  }

  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined
  }

  async setMeta(key: string, value: unknown) {
    if (value === undefined) this.meta.delete(key)
    else this.meta.set(key, value)
  }
}

export async function openDeviceStore(): Promise<DeviceStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryStore()
    const store = new IndexedDbStore(await openDatabase())
    // A write probe: Safari private windows used to open fine and then refuse writes.
    await store.setMeta('probe', Date.now())
    return store
  } catch {
    return new MemoryStore()
  }
}

/** Asks the browser not to clear this site's data when space runs low. */
export function requestPersistence() {
  try {
    void navigator.storage?.persist?.().catch(() => undefined)
  } catch {
    /* not supported */
  }
}

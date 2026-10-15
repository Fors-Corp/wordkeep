import type { StoredEntry } from '@shared/lexicon'

/**
 * Where the lexicon lives on this device: IndexedDB, with one record per word
 * or phrase plus a few settings (sync code, sync cursor, records not yet sent).
 * Falls back to memory when the browser refuses storage (some private modes).
 */
export interface DeviceStore {
  readonly persistent: boolean
  loadEntries(): Promise<StoredEntry[]>
  putEntries(entries: StoredEntry[]): Promise<void>
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
}

const DB_NAME = 'wordkeep'
const VERSION = 1

function done(request: IDBRequest): Promise<unknown> {
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Storage is blocked by another tab'))
  })
}

class IndexedDbStore implements DeviceStore {
  readonly persistent = true
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  async loadEntries(): Promise<StoredEntry[]> {
    const tx = this.db.transaction('entries', 'readonly')
    return (await done(tx.objectStore('entries').getAll())) as StoredEntry[]
  }

  async putEntries(entries: StoredEntry[]): Promise<void> {
    if (!entries.length) return
    const tx = this.db.transaction('entries', 'readwrite')
    const store = tx.objectStore('entries')
    for (const entry of entries) store.put(entry)
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

export class MemoryStore implements DeviceStore {
  readonly persistent = false
  private readonly entries = new Map<string, StoredEntry>()
  private readonly meta = new Map<string, unknown>()

  async loadEntries() {
    return [...this.entries.values()]
  }

  async putEntries(entries: StoredEntry[]) {
    for (const entry of entries) this.entries.set(entry.id, entry)
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

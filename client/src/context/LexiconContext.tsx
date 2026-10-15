import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Lexicon } from '@shared/lexicon'
import type { Stats, WordSummary } from '@shared/types'
import { api } from '../lib/api'
import { DeviceLexicon, type SyncState } from '../lib/deviceLexicon'
import { openDeviceStore, requestPersistence } from '../lib/store'

type LexiconContextValue = {
  /** Null until the device store has been read. */
  device: DeviceLexicon | null
  lexicon: Lexicon
  ready: boolean
  persistent: boolean
  now: number
  stats: Stats | null
  recent: WordSummary[]
  sync: SyncState
  /** Set when the last write to the device failed (storage full or blocked). */
  storageError: unknown
}

const EMPTY = new Lexicon([])
const OFF: SyncState = { key: null, status: 'off', lastSyncedAt: null, error: null }
const SYNC_EVERY = 60_000

const LexiconContext = createContext<LexiconContextValue | null>(null)

const noopSubscribe = () => () => undefined

export function LexiconProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState<DeviceLexicon | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    let opened: DeviceLexicon | null = null
    void (async () => {
      const store = await openDeviceStore()
      opened = await DeviceLexicon.open(store, {
        sync: api.sync,
        legacy: api.legacyExport,
        legacyAck: api.legacyAck,
      })
      if (cancelled) {
        opened.close()
        return
      }
      setDevice(opened)
      requestPersistence()
      void opened.syncNow()
    })()
    return () => {
      cancelled = true
      opened?.close()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
      void device?.syncNow({ auto: true })
    }, SYNC_EVERY)
    if (!device) return () => window.clearInterval(timer)
    const wake = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now())
        void device.syncNow({ auto: true })
      }
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [device])

  const lexicon = useSyncExternalStore(
    device?.subscribe ?? noopSubscribe,
    () => device?.lexicon ?? EMPTY,
  )
  const sync = useSyncExternalStore(
    device?.subscribe ?? noopSubscribe,
    () => device?.sync ?? OFF,
  )

  const storageError = useSyncExternalStore(
    device?.subscribe ?? noopSubscribe,
    () => device?.storageError ?? null,
  )

  // Worked out again only when the records (or the minute) change, not on sync status.
  const stats = useMemo(() => (device ? lexicon.stats(now) : null), [device, lexicon, now])
  const recent = useMemo(() => lexicon.recent(), [lexicon])

  const value = useMemo<LexiconContextValue>(
    () => ({
      device,
      lexicon,
      ready: Boolean(device),
      persistent: device?.persistent ?? true,
      now,
      stats,
      recent,
      sync,
      storageError,
    }),
    [device, lexicon, now, stats, recent, sync, storageError],
  )
  return <LexiconContext.Provider value={value}>{children}</LexiconContext.Provider>
}

export function useLexicon() {
  const ctx = useContext(LexiconContext)
  if (!ctx) throw new Error('useLexicon must be used within LexiconProvider')
  return ctx
}

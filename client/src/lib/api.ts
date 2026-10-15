import type { StoredEntry } from '@shared/lexicon'
import type { Language, LookupResult, PhraseAnalysis, PlayRound, SuggestResponse } from '@shared/types'

/** A failed API call, with the server's machine-readable code when it sent one. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly params: Record<string, string | number>

  constructor(message: string, status: number, code?: string, params: Record<string, string | number> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.params = params
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string
    code?: string
    params?: Record<string, string | number>
  }
  if (res.status === 401 && path !== '/api/login' && path !== '/api/session') {
    window.dispatchEvent(new Event('wordkeep:auth'))
  }
  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code, data.params)
  }
  return data
}

/** `reset` means the server's store was replaced: send everything again and read from the start. */
export type SyncResponse = { cursor: number; changes: StoredEntry[]; more: boolean; reset?: boolean; epoch?: string }
export type SyncRequest = { key: string; since: number; changes: StoredEntry[]; epoch?: string | null }

export const api = {
  languages: () => request<Language[]>('/api/languages'),
  lookup: (q: string, lang: string) =>
    request<LookupResult>(`/api/lookup?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`),
  suggest: (q: string, lang: string, ui: string) =>
    request<SuggestResponse>(
      `/api/suggest?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&ui=${encodeURIComponent(ui)}`,
    ),
  analyzePhrase: (q: string, lang: string, explain: string) =>
    request<PhraseAnalysis>(
      `/api/phrase/analyze?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&explain=${encodeURIComponent(explain)}`,
    ),
  playRound: (lang: string) =>
    request<PlayRound>(`/api/play/round?lang=${encodeURIComponent(lang)}`),
  session: () => request<{ ok: boolean; locked: boolean; signedIn: boolean }>('/api/session'),
  login: (key: string) =>
    request<{ ok: boolean }>('/api/login', { method: 'POST', body: JSON.stringify({ key }) }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  /** Sends records changed on this device and receives what other devices changed since `since`. */
  sync: (body: SyncRequest) =>
    request<SyncResponse>('/api/sync', {
      method: 'POST',
      body: JSON.stringify(body),
      // A hung request would hold the sync lock that every tab waits on.
      signal: AbortSignal.timeout(30_000),
    }),
  /** Words a self-hosted server stored before the lexicon moved to the device. */
  legacyExport: () => request<unknown>('/api/legacy/export'),
  /** Tells the server the old words are saved on this device, so it stops handing them out. */
  legacyAck: () => request<{ ok: boolean }>('/api/legacy/ack', { method: 'POST' }),
}

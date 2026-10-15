import type {
  GraphPayload,
  KeepPhraseInput,
  KeepWordInput,
  Language,
  LookupResult,
  PhraseAnalysis,
  PlayRound,
  SuggestResponse,
  Stats,
  WordDetail,
  WordSummary,
} from '@shared/types'

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

export const api = {
  languages: () => request<Language[]>('/api/languages'),
  stats: () => request<Stats>('/api/stats'),
  lookup: (q: string, lang: string) =>
    request<LookupResult>(`/api/lookup?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`),
  suggest: (q: string, lang: string, ui: string) =>
    request<SuggestResponse>(
      `/api/suggest?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&ui=${encodeURIComponent(ui)}`,
    ),
  words: (params: Record<string, string | undefined> = {}) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value)
    }
    const suffix = search.size ? `?${search}` : ''
    return request<WordSummary[]>(`/api/words${suffix}`)
  },
  recent: () => request<WordSummary[]>('/api/words/recent'),
  analyzePhrase: (q: string, lang: string, explain: string) =>
    request<PhraseAnalysis>(
      `/api/phrase/analyze?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}&explain=${encodeURIComponent(explain)}`,
    ),
  keepPhrase: (input: KeepPhraseInput) =>
    request<{ alreadyKept: boolean; word: WordDetail }>('/api/phrases', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reanalyze: (id: string, explain: string) =>
    request<WordDetail>(`/api/words/${id}/reanalyze`, {
      method: 'POST',
      body: JSON.stringify({ explain }),
    }),
  word: (id: string) => request<WordDetail>(`/api/words/${id}`),
  keep: (input: KeepWordInput) =>
    request<{ alreadyKept: boolean; word: WordDetail }>('/api/words', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  patch: (id: string, body: Record<string, unknown>) =>
    request<WordDetail>(`/api/words/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/words/${id}`, { method: 'DELETE' }),
  queue: () => request<WordDetail[]>('/api/review/queue'),
  grade: (id: string, grade: 'again' | 'hard' | 'good' | 'easy') =>
    request<WordDetail>(`/api/review/${id}/grade`, {
      method: 'POST',
      body: JSON.stringify({ grade }),
    }),
  graph: (wordId?: string) =>
    request<GraphPayload>(wordId ? `/api/graph?wordId=${encodeURIComponent(wordId)}` : '/api/graph'),
  playRound: (lang: string) =>
    request<PlayRound>(`/api/play/round?lang=${encodeURIComponent(lang)}`),
  session: () => request<{ ok: boolean; locked: boolean; signedIn: boolean }>('/api/session'),
  login: (key: string) =>
    request<{ ok: boolean }>('/api/login', { method: 'POST', body: JSON.stringify({ key }) }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  exportLexicon: () => request<Record<string, unknown>>('/api/export'),
  importLexicon: (backup: unknown, mode: 'merge' | 'replace') =>
    request<{ words: number; senses: number; links: number }>('/api/import', {
      method: 'POST',
      body: JSON.stringify({ mode, backup }),
    }),
}

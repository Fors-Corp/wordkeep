import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns JSON on success and encodes query params', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/lookup?q=happy&lang=en')
      return new Response(JSON.stringify({ lemma: 'happy' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await api.lookup('happy', 'en')
    expect(result).toEqual({ lemma: 'happy' })
  })

  it('throws the server error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'No definitions found' }), { status: 404 })),
    )
    await expect(api.lookup('nope', 'en')).rejects.toThrow('No definitions found')
  })

  it('posts sync changes with the code', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/sync')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ key: 'K', since: 3, changes: [] })
      return new Response(JSON.stringify({ cursor: 3, changes: [], more: false }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.sync({ key: 'K', since: 3, changes: [] })).resolves.toEqual({
      cursor: 3,
      changes: [],
      more: false,
    })
  })
})

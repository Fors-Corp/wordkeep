import { describe, expect, it } from 'vitest'
import { translator } from '../i18n'
import { ApiError } from './api'
import { errorText } from './errors'

const { t } = translator('es')

describe('error messages', () => {
  it('are always in the app language, never raw server or browser text', () => {
    expect(errorText(new TypeError('Failed to fetch'), t)).toBe(t('error.network'))
    expect(errorText(new ApiError('Dictionary lookup failed (503)', 502, 'upstream-failed'), t)).toBe(
      t('error.upstream-failed'),
    )
    expect(errorText(new ApiError('fetch failed', 502), t)).toBe(t('error.server'))
    expect(errorText(new ApiError('Missing q', 400), t, 'respaldo')).toBe('respaldo')
    expect(errorText(new ApiError('Query too long', 400, 'query-too-long', { max: 120 }), t)).toContain('120')
    expect(errorText(new Error('boom'), t)).toBe(t('error.server'))
  })
})

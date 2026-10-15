import { en } from '../i18n/en'
import type { MessageKey, Translate } from '../i18n'
import { ApiError } from './api'

/**
 * The message to show for a failed request, always in the app language: the
 * server's code when it sent one, a network or server message otherwise, or
 * the caller's fallback. Raw (English) error text never reaches the reader.
 */
export function errorText(err: unknown, t: Translate, fallback = ''): string {
  if (err instanceof ApiError) {
    if (err.code) {
      const key = `error.${err.code}`
      if (key in en) return t(key as MessageKey, err.params)
    }
    if (err.status >= 500) return t('error.server')
    return fallback || t('error.server')
  }
  // fetch rejects with a TypeError when the network is down ("Failed to fetch", "Load failed").
  if (err instanceof TypeError) return t('error.network')
  return fallback || t('error.server')
}

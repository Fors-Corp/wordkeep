import { en } from '../i18n/en'
import type { MessageKey, Translate } from '../i18n'
import { ApiError } from './api'

/** The message to show for a failed request, in the app language when the server sent a code. */
export function errorText(err: unknown, t: Translate, fallback = ''): string {
  if (err instanceof ApiError && err.code) {
    const key = `error.${err.code}`
    if (key in en) return t(key as MessageKey, err.params)
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}

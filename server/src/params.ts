/**
 * Language codes arrive in query strings and end up in hostnames, file names,
 * URLs and regular expressions, so only plain BCP 47-style codes are let
 * through: "en", "pt-br", "zh-hans", "cmn".
 */
const LANG_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i

export function isLangCode(value: string): boolean {
  return LANG_CODE.test(value)
}

/** Longest single word or query accepted by lookup and suggest. */
export const MAX_QUERY_CHARS = 120

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

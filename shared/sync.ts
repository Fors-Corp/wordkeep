/**
 * Sync codes: 26 base32 characters (130 random bits), shown in groups of
 * four. Anyone with the code can read and change that lexicon, so it is the
 * secret; the server only ever sees a hash of it.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function createSyncKey(
  random: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = random(17)
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < 26) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out
}

/** Accepts the code with or without dashes or spaces, in any case; null if malformed. */
export function normalizeSyncKey(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '')
  return /^[A-Z2-7]{26}$/.test(clean) ? clean : null
}

export function formatSyncKey(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') ?? key
}

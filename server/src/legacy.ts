import { db } from './db.ts'

/**
 * Before 2.0 the server kept the lexicon in SQLite. If this server still has
 * those tables, hand their rows over in the old backup format so a device can
 * import them. Once a device confirms it saved them, the server stops handing
 * them out (other devices get them through sync); the tables stay untouched.
 */

function tables(): Set<string> {
  return new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )
}

function handedOver(names: Set<string>): boolean {
  if (!names.has('legacy_handover')) return false
  return Boolean(db.prepare('SELECT 1 FROM legacy_handover LIMIT 1').get())
}

export function legacyExport(): {
  version: 1
  exportedAt: number
  words: Array<Record<string, unknown>>
  senses: Array<Record<string, unknown>>
  links: Array<Record<string, unknown>>
} | null {
  const names = tables()
  if (!names.has('words') || !names.has('senses') || !names.has('word_links')) return null
  if (handedOver(names)) return null
  return {
    version: 1,
    exportedAt: Date.now(),
    words: db.prepare('SELECT * FROM words').all() as Array<Record<string, unknown>>,
    senses: db.prepare('SELECT * FROM senses').all() as Array<Record<string, unknown>>,
    links: db.prepare('SELECT * FROM word_links').all() as Array<Record<string, unknown>>,
  }
}

export function markLegacyHandedOver() {
  const names = tables()
  if (!names.has('words')) return
  db.exec('CREATE TABLE IF NOT EXISTS legacy_handover (at INTEGER NOT NULL)')
  if (!handedOver(tables())) db.prepare('INSERT INTO legacy_handover (at) VALUES (?)').run(Date.now())
}

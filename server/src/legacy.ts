import { db } from './db.ts'

/**
 * Before 2.0 the server kept the lexicon in SQLite. If this server still has
 * those tables, hand their rows over once in the old backup format so the
 * device can import them; the tables are left untouched.
 */
export function legacyExport(): {
  version: 1
  exportedAt: number
  words: Array<Record<string, unknown>>
  senses: Array<Record<string, unknown>>
  links: Array<Record<string, unknown>>
} | null {
  const tables = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )
  if (!tables.has('words') || !tables.has('senses') || !tables.has('word_links')) return null
  return {
    version: 1,
    exportedAt: Date.now(),
    words: db.prepare('SELECT * FROM words').all() as Array<Record<string, unknown>>,
    senses: db.prepare('SELECT * FROM senses').all() as Array<Record<string, unknown>>,
    links: db.prepare('SELECT * FROM word_links').all() as Array<Record<string, unknown>>,
  }
}

import type { SQLInputValue } from 'node:sqlite'
import { db } from './db.ts'

export type LexiconBackup = {
  version: 1
  exportedAt: number
  words: Array<Record<string, unknown>>
  senses: Array<Record<string, unknown>>
  links: Array<Record<string, unknown>>
}

export function exportLexicon(): LexiconBackup {
  return {
    version: 1,
    exportedAt: Date.now(),
    words: db.prepare('SELECT * FROM words').all() as Array<Record<string, unknown>>,
    senses: db.prepare('SELECT * FROM senses').all() as Array<Record<string, unknown>>,
    links: db.prepare('SELECT * FROM word_links').all() as Array<Record<string, unknown>>,
  }
}

function isBackup(value: unknown): value is LexiconBackup {
  if (!value || typeof value !== 'object') return false
  const body = value as LexiconBackup
  return body.version === 1 && Array.isArray(body.words) && Array.isArray(body.senses) && Array.isArray(body.links)
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function insertRows(table: string, rows: Array<Record<string, unknown>>, or: 'REPLACE' | 'IGNORE') {
  for (const row of rows) {
    const keys = Object.keys(row)
    if (!keys.length) continue
    const sql = `INSERT OR ${or} INTO ${table} (${keys.join(', ')}) VALUES (${placeholders(keys.length)})`
    db.prepare(sql).run(...keys.map((key) => row[key] as SQLInputValue))
  }
}

export function importLexicon(raw: unknown, mode: 'merge' | 'replace' = 'merge'): { words: number; senses: number; links: number } {
  if (!isBackup(raw)) throw new Error('Invalid backup file')
  if (mode === 'replace') {
    db.exec('DELETE FROM word_links')
    db.exec('DELETE FROM senses')
    db.exec('DELETE FROM words')
  }
  const or = mode === 'replace' ? 'REPLACE' : 'IGNORE'
  insertRows('words', raw.words, or)
  insertRows('senses', raw.senses, or)
  insertRows('word_links', raw.links, or)
  return { words: raw.words.length, senses: raw.senses.length, links: raw.links.length }
}

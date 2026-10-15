import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { writableDir } from './paths.ts'

const dbPath = process.env.WORDKEEP_DB ?? join(writableDir(), 'wordkeep.db')
if (dbPath !== ':memory:') {
  try {
    mkdirSync(dirname(dbPath), { recursive: true })
  } catch {
    /* serverless parent dirs may already exist */
  }
}

export const db = new DatabaseSync(dbPath)

db.exec('PRAGMA journal_mode = WAL')

export { normalizeLemma } from '../../shared/lexicon.ts'

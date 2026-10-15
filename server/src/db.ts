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
db.exec('PRAGMA foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id TEXT PRIMARY KEY,
    lemma TEXT NOT NULL,
    display_lemma TEXT NOT NULL,
    language TEXT NOT NULL,
    language_name TEXT NOT NULL,
    phonetic TEXT,
    etymology TEXT,
    note TEXT NOT NULL DEFAULT '',
    primary_sense_id TEXT,
    archived_at INTEGER,
    status TEXT NOT NULL DEFAULT 'new',
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval_days REAL NOT NULL DEFAULT 0,
    repetitions INTEGER NOT NULL DEFAULT 0,
    due_at INTEGER NOT NULL,
    last_reviewed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    forms_json TEXT,
    UNIQUE(lemma, language)
  );

  CREATE TABLE IF NOT EXISTS senses (
    id TEXT PRIMARY KEY,
    word_id TEXT NOT NULL,
    part_of_speech TEXT,
    definition TEXT NOT NULL,
    synonyms_json TEXT,
    antonyms_json TEXT,
    tags_json TEXT,
    examples_json TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(word_id) REFERENCES words(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS word_links (
    id TEXT PRIMARY KEY,
    from_word_id TEXT NOT NULL,
    to_lemma TEXT NOT NULL,
    to_language TEXT NOT NULL,
    to_language_name TEXT NOT NULL,
    to_word_id TEXT,
    relation TEXT NOT NULL DEFAULT 'translation',
    FOREIGN KEY(from_word_id) REFERENCES words(id) ON DELETE CASCADE,
    UNIQUE(from_word_id, to_lemma, to_language, relation)
  );

  CREATE INDEX IF NOT EXISTS idx_words_due ON words(due_at);
  CREATE INDEX IF NOT EXISTS idx_words_lang ON words(language);
  CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);
  CREATE INDEX IF NOT EXISTS idx_links_to ON word_links(to_lemma, to_language);
`)

function ensureColumn(table: string, column: string, sqlType: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`)
  }
}

const linksSql = (
  db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'word_links'`).get() as
    | { sql: string }
    | undefined
)?.sql
if (linksSql && !linksSql.includes('to_language, relation') && !linksSql.includes('to_language,relation')) {
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec(`
    CREATE TABLE word_links_v2 (
      id TEXT PRIMARY KEY,
      from_word_id TEXT NOT NULL,
      to_lemma TEXT NOT NULL,
      to_language TEXT NOT NULL,
      to_language_name TEXT NOT NULL,
      to_word_id TEXT,
      relation TEXT NOT NULL DEFAULT 'translation',
      FOREIGN KEY(from_word_id) REFERENCES words(id) ON DELETE CASCADE,
      UNIQUE(from_word_id, to_lemma, to_language, relation)
    );
    INSERT OR IGNORE INTO word_links_v2
      (id, from_word_id, to_lemma, to_language, to_language_name, to_word_id, relation)
      SELECT id, from_word_id, to_lemma, to_language, to_language_name, to_word_id,
             COALESCE(relation, 'translation')
      FROM word_links;
    DROP TABLE word_links;
    ALTER TABLE word_links_v2 RENAME TO word_links;
    CREATE INDEX IF NOT EXISTS idx_links_to ON word_links(to_lemma, to_language);
  `)
  db.exec('PRAGMA foreign_keys = ON')
}

ensureColumn('senses', 'antonyms_json', 'TEXT')
ensureColumn('senses', 'tags_json', 'TEXT')
ensureColumn('senses', 'examples_json', 'TEXT')
ensureColumn('words', 'forms_json', 'TEXT')
ensureColumn('words', 'kind', "TEXT NOT NULL DEFAULT 'word'")
ensureColumn('words', 'analysis_json', 'TEXT')

try {
  db.exec(`
    UPDATE senses
    SET examples_json = json_array(example)
    WHERE (examples_json IS NULL OR examples_json = '' OR examples_json = '[]')
      AND example IS NOT NULL AND example != ''
  `)
} catch {
  /* new databases have no example column */
}

export function normalizeLemma(word: string, language: string): string {
  const trimmed = word.trim().normalize('NFC')
  try {
    return trimmed.toLocaleLowerCase(language)
  } catch {
    return trimmed.toLocaleLowerCase('en')
  }
}

export function findWordId(lemma: string, language: string): string | null {
  const row = db
    .prepare('SELECT id FROM words WHERE lemma = ? AND language = ?')
    .get(normalizeLemma(lemma, language), language) as { id: string } | undefined
  return row?.id ?? null
}

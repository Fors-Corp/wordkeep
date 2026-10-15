# Changelog

All notable changes to Wordkeep are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-15

### Added

- Phrases. Type several words and the search box switches to phrase mode; a Word / Phrase toggle overrides the guess. Press Enter (or Analyze) to break the phrase down.
- Dictionary grammar breakdown for every language: part of speech, dictionary form, inflection (“simple past of sit”), gloss, and whole-phrase idioms found in Wiktionary.
- Optional Claude analysis when `ANTHROPIC_API_KEY` is set: syntactic roles, sentence type, tense, mood, voice, clauses, idioms, a translation into the reader's language, and quiz questions. Falls back to the dictionary breakdown on any error.
- Keep phrases for recall. They appear in the lexicon (with a words / phrases filter), stats, export/import, and the atlas, linked to the words they contain, both for words kept earlier and for words kept later.
- Phrase review cards rotate between meaning recall, a cloze (fill the gap), and a grammar question.
- “Re-analyze grammar” on a kept phrase, e.g. after adding an API key.
- `GET /api/phrase/analyze`, `POST /api/phrases`, `POST /api/words/:id/reanalyze`, and `?kind=word|phrase` on `GET /api/words`.
- GitHub Actions CI: lint, typecheck, unit tests, build, and Playwright.

### Fixed

- `tsc` on the server package (TypeScript extension imports and a SQLite typing in backup import).

## [1.0.1]

- Vercel deploy fixes: bundled API function, SQLite and word banks under `/tmp`, fetch handlers.

## [1.0.0]

- First release: lookups in 200+ languages, SM-2 review, export/import, 3D atlas, Discover.

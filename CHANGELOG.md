# Changelog

All notable changes to Wordkeep are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [1.2.1] - 2026-10-15

### Fixed

- On Vercel, API routes with more than one path segment (`/api/phrase/analyze`, `/api/words/recent`, `/api/words/:id`, `/api/review/queue`, `/api/play/round`, …) returned 404. The API now deploys as a single `api/index.js` function and every `/api/*` path is rewritten to it.
- Phone keyboard suggestions and autocorrect work in the search box, in the selected dictionary language. Phrases start with a capital letter; single words do not.

## [1.2.0] - 2026-10-15

### Added

- Claude rate limits: a daily cap per visitor (hashed IP) and for the whole app, configurable with `WORDKEEP_AI_DAILY_PER_VISITOR` and `WORDKEEP_AI_DAILY_TOTAL`. Past a cap, visitors get the dictionary breakdown.
- Shared 30-day cache of Claude analyses, so a phrase is paid for once.
- Upstash Redis support (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`) for limits and cache across serverless instances. On Vercel, Claude stays off without it.
- Atlas shows the key words of every kept phrase as linked nodes, even words you have not kept.
- Light / Dark / Auto theme switch, remembered per browser.
- Part-of-speech key under each phrase breakdown, and clearer hints on Introduce and Review.

### Changed

- Phrase analysis uses Claude Sonnet 5.5 by default.
- Contrast raised to WCAG AA for every text color in both themes; the smallest labels are larger.

### Fixed

- Dark theme colors leaked into the light theme (Tailwind hoisted the dark `@theme`), making headings and words nearly invisible.
- Atlas labels are readable in the light theme.

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

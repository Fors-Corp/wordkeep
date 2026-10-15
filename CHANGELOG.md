# Changelog

All notable changes to Wordkeep are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-10-15

### Changed

- **Your lexicon is stored on your device** (the browser's IndexedDB) instead of on the server. On Vercel, each serverless instance kept its own copy, so a kept word could open as “Not found” moments later. Every page now reads and writes the lexicon locally and works without a server round trip.
- First visit starts with an empty lexicon. **Load sample words** adds the linked demo cluster and a sample phrase.
- Every edit is stamped later than the version it changed, so an edit is never lost to a device whose clock runs behind.

### Added

- Sync between devices with a private code (Lexicon → Sync across devices). Entries merge per record and the newest change wins; deletions sync as tombstones. The server stores records under a hash of the code.
- `POST /api/sync`, backed by Turso (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) or the server's SQLite file when self-hosted. On Vercel without Turso it answers `503 sync-unavailable`, and the app says so.
- Older servers hand their stored words to the first browser that opens them (`GET /api/legacy/export`). Backups from 1.x import as before.
- Installable on phones: web app manifest and Home Screen icons. On iPhone this keeps Safari from clearing the lexicon after 7 days without a visit.
- When a device cannot draw the 3D atlas, it shows the links as a list instead of failing the page.
- A clear “entry not found” page in the app language, with a way back to the lexicon.

### Removed

- The server's lexicon API: `/api/words*`, `/api/phrases`, `/api/review*`, `/api/stats`, `/api/graph`, `/api/export`, `/api/import`. Lookup, phrase analysis, suggestions and Discover are unchanged.
- `WORDKEEP_SEED` and `npm run seed:graph`; sample words now load from the app.

## [1.3.0] - 2026-10-15

### Added

- The interface is translated into Catalan, Spanish, Portuguese, English, German, French and Italian. The language follows the browser on first visit and is remembered after you pick one.
- A language menu in the header (a popover on wide screens, a bottom sheet on phones) lists each language with its flag, its own name, and its code (CA, ES, PT, EN, DE, FR, IT). Flags are SVG, so they look the same on every device.
- “Explain phrases in their own language” in the same menu: off, Claude’s explanations, translations and quiz questions use the app language; on, they use the phrase’s language.
- Parts of speech, sentence facts, analysis notices, dictionary quiz questions, due dates and language names follow the app language.
- The server returns codes (`notice`, `template`, error `code`) so the app can word notices, questions and errors in any language; the English text stays for API clients.

### Changed

- Claude now writes roles, inflection features, sentence type, tense, mood, voice and clause types in the explanation language too; parts of speech stay as English keys so the app can translate and color them.

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

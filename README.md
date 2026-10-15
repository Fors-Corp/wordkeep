# Wordkeep

[![Support · 1,99 €](https://img.shields.io/badge/Support-1%2C99_%E2%82%AC-2f855a)](https://marcfors.com/donate?from=wordkeep)

A personal lexicon: look up a word, keep its definitions, examples, and etymology, then review it with spaced repetition. Type a whole phrase and Wordkeep breaks it down grammatically. Words and phrases link across languages as a 3D atlas. Discover is a matching game drawn from large frequency lists.

## Run locally

```bash
npm install
npm run dev
```

- App: http://localhost:5173
- API: http://127.0.0.1:3001

Your lexicon lives in the browser on your device (IndexedDB). No account needed. On an empty lexicon, **Load sample words** adds a linked English/Spanish/French/German cluster and a phrase to try Review and the Atlas.

### Sync between devices

In **Lexicon → Sync across devices**, **Turn on sync** creates a private 26-character code. Enter it on your other phones and computers (**I have a code**) and they share one lexicon. Changes merge per entry, and the newest edit wins. Deletions sync too.

- The code is the only secret: anyone with it can read and change that lexicon. The server stores only a hash of it.
- Self-hosted (Docker, Fly, `npm run start`), sync records go in the server's SQLite file. Nothing to set up.
- On Vercel, connect a [Turso](https://turso.tech) database (Vercel → Storage / Marketplace → Turso Cloud), which sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then redeploy. Without it, sync says it is not set up and everything else keeps working on the device.
- Limits: 20,000 entries per code, 500 changes per request.
- On iPhone, add Wordkeep to the Home Screen (Share → Add to Home Screen). Safari can clear website data after 7 days without a visit, and Home Screen apps are exempt. Sync is the backup either way.

A server that stored words before 2.0 hands them to the first browser that opens it and saves them (`GET /api/legacy/export`, confirmed with `POST /api/legacy/ack`); turn on sync there to bring them to your other devices.

Several tabs can stay open at once: they share the device's lexicon and see each other's changes. If the same word was kept separately on two devices, the copies merge into one entry (the one with the most reviews stays) when they sync.

Set `WORDKEEP_ACCESS_KEY` to require a key before anyone can use the app or its API. Signing in sets a session cookie derived from the key (not the key itself); scripts can send `Authorization: Bearer <key>`. Ten wrong keys from one visitor pause logins for 15 minutes.

Set `ANTHROPIC_API_KEY` to have Claude analyze phrases (structure, tense, idioms, translation, quiz questions). Without it, phrases get a word-by-word dictionary breakdown. `ANTHROPIC_MODEL` overrides the model (default `claude-sonnet-5-5`).

### Keeping Claude costs bounded

Each Claude analysis is a paid API call, so every visitor is rate limited:

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORDKEEP_AI_DAILY_PER_VISITOR` | `10` | Claude analyses per visitor (hashed IP) per UTC day |
| `TRUST_PROXY` | — | Set to `1` behind your own reverse proxy so visitors are told apart by the last `X-Forwarded-For` hop. Vercel and Fly are recognized without it; otherwise the socket address is used and forwarding headers are ignored. |
| `WORDKEEP_AI_DAILY_TOTAL` | `100` | Claude analyses for the whole app per UTC day |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) | — | Upstash Redis for shared counters and the analysis cache |

- Past a limit, visitors still get the free dictionary breakdown with a short note.
- Claude results are cached for 30 days, so a repeated phrase, keeping a phrase, or a second visitor asking the same thing costs nothing.
- Counters and the cache live in SQLite on a single server (Docker, Fly). **On Vercel, serverless instances do not share SQLite, so Claude stays off until Upstash Redis is connected** (Vercel → Storage / Marketplace → Upstash for Redis, which sets the `KV_REST_API_*` variables).
- Also set a monthly spend limit in the Anthropic Console; it is the hard cap no matter what.
- `WORDKEEP_ACCESS_KEY` still locks the whole app if you prefer that.

## What it does

- Look up a word in 200+ languages. Non-English entries prefer native Wiktionary definitions and etymology.
- Save senses, examples, etymology, and an optional mnemonic. The definition is never something you type.
- Type several words and the search box switches to phrase mode (or pick **Word** / **Phrase** yourself). Press Enter to analyze:
  - every word gets its part of speech, dictionary form, and inflection from Wiktionary;
  - with an Anthropic API key, Claude adds each word's role, the sentence type, tense, mood and voice, clauses, idioms, a translation into your browser's language, and quiz questions.
- Keep phrases like words. They join the lexicon (filter by words or phrases), export/import, the atlas (linked to the words they contain), and review.
- Light, dark, or automatic theme from the switch in the header; text meets WCAG AA contrast in both.
- The interface speaks Català, Español, Português, English, Deutsch, Français and Italiano (globe menu in the header). Phrase analyses use that language, or, with “Explain phrases in their own language”, the phrase’s language. Dictionary definitions stay as Wiktionary wrote them.
- Review due cards with Again / Hard / Good / Easy (SM-2). Phrase cards rotate between meaning recall, a fill-the-gap cloze, and a grammar question.
- Browse, filter, export, and import the lexicon as JSON (backups from 1.x import too).
- See synonyms, antonyms, translations, and related words on a rotatable 3D atlas.
- Discover: match five less-common words to their meanings.

Dictionary data comes from [Free Dictionary API](https://freedictionaryapi.com/) (Wiktionary). Native definitions and etymology are parsed from each language’s Wiktionary; English Wiktionary is the fallback.

## Tests

```bash
npm run test:unit    # server (node:test) + client (vitest)
npm run test:e2e     # Playwright against a throwaway API + Vite
npm test             # unit, then e2e
npm run lint         # oxlint (client)
npm run typecheck    # server + client
```

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, the build, and Playwright on every pull request, once GitHub Actions is allowed for the repository (organization Settings → Actions → General).

Live demo: https://wordkeep-zeta.vercel.app

Source: https://github.com/Fors-Corp/wordkeep

Phrase analysis with Claude takes several seconds; on Vercel, raise the function's max duration if requests time out. For Claude on Vercel, add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables and connect Upstash Redis (see above).

Kept words live on each device, so a Vercel deploy needs no database for them. Sync on Vercel needs Turso (see **Sync between devices**).

## Production

```bash
npm run build
NODE_ENV=production npm run start -w server
```

The API then serves `client/dist` on the same origin. Docker:

```bash
docker build -t wordkeep .
docker run --rm -p 3001:3001 -v wordkeep-data:/data wordkeep
```

Deploy to [Fly.io](https://fly.io) (a small VM with a persistent volume for the sync records and Claude cache):

```bash
fly launch --copy-config --yes
fly volumes create wordkeep_data --region iad --size 1
fly secrets set WORDKEEP_ACCESS_KEY=your-private-key
fly secrets set ANTHROPIC_API_KEY=sk-ant-...   # optional: full phrase grammar
fly deploy
```

If this project is useful to you, you can [support it with 1,99 €](https://marcfors.com/donate?from=wordkeep).

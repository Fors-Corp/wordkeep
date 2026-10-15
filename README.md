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

SQLite lives at `server/data/wordkeep.db`. No account, no cloud.

Optional:

```bash
WORDKEEP_SEED=1 npm run dev:api   # demo cluster for Atlas
npm run seed:graph -w server      # same, one-shot
```

Set `WORDKEEP_ACCESS_KEY` to require a key before anyone can read or write the lexicon.

Set `ANTHROPIC_API_KEY` to have Claude analyze phrases (structure, tense, idioms, translation, quiz questions). Without it, phrases get a word-by-word dictionary breakdown. `ANTHROPIC_MODEL` overrides the model (default `claude-sonnet-5-5`).

### Keeping Claude costs bounded

Each Claude analysis is a paid API call, so every visitor is rate limited:

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORDKEEP_AI_DAILY_PER_VISITOR` | `10` | Claude analyses per visitor (hashed IP) per UTC day |
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
- Review due cards with Again / Hard / Good / Easy (SM-2). Phrase cards rotate between meaning recall, a fill-the-gap cloze, and a grammar question.
- Browse, filter, export, and import the lexicon as JSON.
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

GitHub Actions runs lint, typecheck, unit tests, the build, and Playwright on every pull request.

Live demo: https://wordkeep-zeta.vercel.app

Source: https://github.com/marcfs31/wordkeep

Phrase analysis with Claude takes several seconds; on Vercel, raise the function's max duration if requests time out. For Claude on Vercel, add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables and connect Upstash Redis (see above).

The Vercel Hobby deploy stores SQLite in `/tmp`, so kept words last for the life of a serverless instance. For a durable personal lexicon, run Docker on [Fly.io](https://fly.io) with the volume in `fly.toml` (`fly auth login` then `fly deploy`). Persistent SQLite on Vercel needs a Turso database (accept marketplace terms, then `vercel integration add tursocloud/database`).

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

Deploy to [Fly.io](https://fly.io) (free allowance, persistent volume for SQLite):

```bash
fly launch --copy-config --yes
fly volumes create wordkeep_data --region iad --size 1
fly secrets set WORDKEEP_ACCESS_KEY=your-private-key
fly secrets set ANTHROPIC_API_KEY=sk-ant-...   # optional: full phrase grammar
fly deploy
```

If this project is useful to you, you can [support it with 1,99 €](https://marcfors.com/donate?from=wordkeep).

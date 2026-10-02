# Wordkeep

[![Support · 1,99 €](https://img.shields.io/badge/Support-1%2C99_%E2%82%AC-2f855a)](https://marcfors.com/donate?from=wordkeep)

A personal lexicon: look up a word, keep its definitions, examples, and etymology, then review it with spaced repetition. Words link across languages as a 3D atlas. Discover is a matching game drawn from large frequency lists.

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

## What it does

- Look up a word in 200+ languages. Non-English entries prefer native Wiktionary definitions and etymology.
- Save senses, examples, etymology, and an optional mnemonic. The definition is never something you type.
- Review due cards with Again / Hard / Good / Easy (SM-2).
- Browse, filter, export, and import the lexicon as JSON.
- See synonyms, antonyms, translations, and related words on a rotatable 3D atlas.
- Discover: match five less-common words to their meanings.

Dictionary data comes from [Free Dictionary API](https://freedictionaryapi.com/) (Wiktionary). Native definitions and etymology are parsed from each language’s Wiktionary; English Wiktionary is the fallback.

## Tests

```bash
npm run test:unit    # server (node:test) + client (vitest)
npm run test:e2e     # Playwright against a throwaway API + Vite
npm test             # unit, then e2e
```

Live demo: https://wordkeep-zeta.vercel.app

Source: https://github.com/marcfs31/wordkeep

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
fly deploy
```

If this project is useful to you, you can [support it with 1,99 €](https://marcfors.com/donate?from=wordkeep).

# Business Cards Manager

A web app for an office that receives many business cards, in Arabic and English.
Staff add contacts by pasting text or uploading a photo of cards; a free AI model
(called through the OpenRouter API) **suggests** the contacts, a person reviews them and
presses Save. Anyone in the office can then find a contact by typing, or by asking a
question in English or Arabic.

- The AI never saves anything by itself.
- Each department sees only its own contacts; High Management sees all.
- Quick search, the table, edit, delete, export and manual add never use the AI.
- Installable on a phone as an app (online only: no contacts are stored on the device).

Full specification: [`docs/plan.md`](docs/plan.md). Background and risks:
[`docs/idea.md`](docs/idea.md). Env keys, commands and request formats:
[`docs/tools.md`](docs/tools.md). Step-by-step and troubleshooting:
[`docs/instructions.md`](docs/instructions.md).

## What you need

| Thing                                 | Notes                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Node.js 22.9 or newer                 |                                                                                                             |
| An OpenRouter API key                 | Free: <https://openrouter.ai>. No card needed for free models                                               |
| A MongoDB **Atlas** connection string | Free M0 cluster, or Atlas Local in Docker. Plain MongoDB Community does not work: search needs Atlas Search |

## Setup from zero

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in the three required values in `.env.local`:

| Key                  | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| `AUTH_SECRET`        | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `OPENROUTER_API_KEY` | Your OpenRouter key                                                              |
| `MONGODB_URI`        | The Atlas connection string (`mongodb+srv://…`)                                  |

Then:

```bash
npm run db:setup
```

```bash
npm run users:add-admin -- admin --name "Your Name"
```

```bash
npm run dev
```

Open <http://127.0.0.1:3000>, sign in as the admin, then add departments and users
(**Departments** and **Users** in the sidebar).

Optional sample data (30 invented contacts):

```bash
npm run db:seed -- --department "High Management" --sample
```

### OpenRouter: key and privacy setting

1. Create a key on the OpenRouter **Keys** page and put it in `.env.local`. Never commit
   it or paste it in a chat.
2. Open the account's **privacy settings** and allow free endpoints that may train on or
   publish prompts. If this is off, every AI action answers "The AI model is not
   available" (OpenRouter says: "No endpoints found matching your data policy").
3. **Use test data only** until the office decides whether real contacts may be sent to
   free endpoints (`docs/idea.md` §7). Free endpoints may log prompts or train on them.
4. Optional: buying $10 of credits once raises the daily free cap from 50 to 1,000
   requests. Free models stay free.

### MongoDB without an Atlas account (local testing)

```bash
docker run -d --name atlas -p 27017:27017 mongodb/mongodb-atlas-local:latest
```

`.env.local`: `MONGODB_URI=mongodb://127.0.0.1:27017/?directConnection=true`

## Choosing the models

Models are env values only (`AI_MODEL_TEXT`, `AI_MODEL_VISION`). The default,
`openrouter/free`, lets OpenRouter pick a free model per request: fine for a first try,
not repeatable for measuring.

```bash
npm run ai:models
```

lists today's free models by ability (tool calling for text and Ask AI, image input for
photos) and checks the configured ones. For each candidate set it in `.env.local`, then:

```bash
npm run ai:smoke
```

```bash
npm run ai:smoke -- --tools
```

```bash
npm run eval:text -- --limit 3
```

If a model rejects structured output (HTTP 400 or 404), set `AI_JSON_MODE=prompt`.
Details: `docs/instructions.md` §4. Record the chosen models and eval numbers in
`docs/plan.md` Progress.

By default the config refuses a model id that is not free (`openrouter/free` or ending
in `:free`) unless `AI_ALLOW_PAID=true`.

## Environment

Every key is listed in [`.env.example`](.env.example) and explained in
`docs/tools.md` §4. A missing or invalid key stops the server at startup with one error
listing every problem.

## Scripts

| Command                                                        | What it does                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`                                                  | Dev server on `http://127.0.0.1:3000` (this machine only)                          |
| `npm run build && npm start`                                   | Production build on this machine, to test before a deploy                          |
| `npm run check`                                                | Lint + format check + typecheck + unit tests (no network, no database)             |
| `npm run test:db`                                              | Database tests. `MONGODB_DB` must contain `test`                                   |
| `npm run db:setup`                                             | Indexes + the Atlas Search index (once per database; safe to re-run)               |
| `npm run db:seed -- --department <name> --sample`              | The 30 sample contacts (`--count N` for load tests)                                |
| `npm run users:add-admin -- <username> --name "Full Name"`     | First admin; asks for the password                                                 |
| `npm run import:csv -- <file> --department <name> [--dry-run]` | Import a CSV; report in `import-reports/`                                          |
| `npm run ai:models`                                            | Free models by ability; checks the configured ones (no key, no requests)           |
| `npm run ai:smoke` / `-- --tools`                              | One real AI call / one real tool loop                                              |
| `npm run eval:text` / `eval:photo` / `eval:search`             | Accuracy reports on the real API (they spend the daily allowance: use `--limit N`) |
| `npm run eval:search -- --quick-only`                          | Quick-search check only (no AI)                                                    |
| `npm run fixtures:photos`                                      | Re-renders the synthetic card photos                                               |

`eval:search` uses its own database (`EVAL_DB`, default `cards_eval`) and deletes every
contact there first.

### Trying the pages without a key

```bash
node tests/mock-ai/server.mjs
```

and set `OPENROUTER_BASE_URL=http://127.0.0.1:4010` in `.env.local`. The mock answers
the text fixtures in `tests/fixtures/text/`, any photo, and Ask AI. It still needs a
database.

## Deploying (Vercel)

1. Import the repository in Vercel.
2. Set every key of `.env.example` that you use in the project's environment settings
   (at least the three required ones).
3. In Atlas, allow access from anywhere (`0.0.0.0/0`), because Vercel has no fixed
   address. Pick the Vercel region next to the Atlas cluster in `vercel.json`
   (default `fra1`, Frankfurt).
4. Run `npm run db:setup` and `npm run users:add-admin` once from your own machine with
   the production `MONGODB_URI`.
5. The three AI routes allow up to 300 seconds (`maxDuration`). If your Vercel plan
   allows less, lower `maxDuration` in `src/app/api/ask/route.ts` and
   `src/app/api/extract/*/route.ts`, and keep `AI_DEADLINE_MS` at least 20 s below it.
6. On a phone, open the HTTPS address and use "Add to Home Screen" / "Install app".

## Troubleshooting

| Symptom                                              | Fix                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Startup error naming `AI_MODEL_*`                    | Use a `:free` model id, or set `AI_ALLOW_PAID=true` on purpose                                                                  |
| "The AI model is not available"                      | OpenRouter privacy setting (above), `AI_DATA_COLLECTION=deny` leaves no provider, or the model was removed: `npm run ai:models` |
| "Today's free AI allowance is used up"               | Wait for the daily reset, or buy the one-time $10 of credits                                                                    |
| "AI service is busy" often                           | Add `AI_FALLBACK_MODELS_TEXT` / `AI_FALLBACK_MODELS_VISION`, or try another model                                               |
| "The AI returned data in an unexpected format" often | `AI_JSON_MODE=prompt`, or another model                                                                                         |
| "You have used your AI allowance for today"          | That person reached `AI_USER_DAILY_LIMIT` (default 15)                                                                          |
| Quick search returns nothing                         | `npm run db:setup`, then wait a minute for the search index                                                                     |
| "Database is not reachable"                          | Check `MONGODB_URI` and the Atlas network access list                                                                           |
| Everyone was signed out                              | `AUTH_SECRET` changed                                                                                                           |

The longer list is in `docs/instructions.md` §7. The server log has one `[ai]` line per
AI call (prompt id, model, time, tokens, error text) and never contains contact data.

## Project layout

```
src/app/            pages and API routes (thin: access check → validate → one module function)
src/modules/ai/     the only code that calls OpenRouter
src/modules/        accounts, audit, contacts, extraction, search, db, shared
src/components/     the UI
scripts/            setup, seed, import, AI checks and evals
tests/unit/         no network, no database (fetch is mocked)
tests/db/           database tests (department isolation, roles, sign-in, AI limits)
tests/fixtures/     invented sample contacts, texts, synthetic card photos, questions
```

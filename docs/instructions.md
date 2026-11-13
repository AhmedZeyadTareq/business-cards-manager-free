# instructions.md — How to set up, build and run the app

Read `idea.md` first (what and why), then `plan.md` (the full specification and the source of truth). `tools.md` has the env keys, commands and OpenRouter request formats. This file is the step-by-step.

OpenRouter screens, limits and free models change. Where this file and <https://openrouter.ai/docs> disagree, the OpenRouter documentation wins.

---

## 1. What you need

| Thing | Notes |
|---|---|
| Node.js 22+ and npm | |
| Git + an empty repository | |
| OpenRouter account | Free. No card needed for free models |
| MongoDB Atlas account (free M0 cluster) | Or Docker with Atlas Local, for a fully local test setup |

## 2. One-time accounts setup (done by a person)

### 2.1 OpenRouter
1. Sign up at <https://openrouter.ai> and create an API key (Keys page). Put it in `.env.local` as `OPENROUTER_API_KEY`. Never commit it or paste it in chat.
2. Open the account's **privacy settings**. Free endpoints are only used if the setting that allows free endpoints which may train on or publish prompts is turned on. If it is off, requests to free models fail with "No endpoints found matching your data policy".
3. Decide the privacy question in `idea.md` §7 **before** entering real contacts. Until then use test data only.
4. Optional: buy $10 of credits once. Free models stay free; the daily cap rises from 50 to 1,000 requests. Never let the balance go negative: free models then fail with 402.

### 2.2 MongoDB Atlas
1. Create a free M0 cluster in a region close to the users. The database name is `cards` (created on first use).
2. Create a database user, and allow your network address (for Vercel: allow all addresses, `0.0.0.0/0`).
3. Put the connection string in `.env.local` as `MONGODB_URI`.

Fully local alternative: run Atlas Local in Docker (`mongodb/mongodb-atlas-local` image) and point `MONGODB_URI` at it. It includes Atlas Search. Plain MongoDB Community does not.

The free tier has no automatic backups, and deletes in the app are permanent. Move to a paid tier before real contacts arrive.

---

## 3. Building the app

1. The agent instruction file `CLAUDE.md` is at the repository root and the other four docs are in `docs/`.
2. Build phase by phase, in the order of `plan.md` §11. For each phase:
   - build only what the phase lists;
   - pass every **Done when** check and `npm run check`;
   - update the Progress table in `plan.md`;
   - commit, report (built / tested / numbers / issues), and wait for approval.
3. Phases that need a person:

| Phase | What the person does |
|---|---|
| 1 | Creates the Atlas cluster and gives `MONGODB_URI` |
| 2 | Creates the OpenRouter key and checks the privacy setting |
| 4, 5 | Approves the chosen models, or decides what to do if a target is missed |
| 7 | Supplies the logo, colours and Team page names, and tries the app on a phone |

4. What can be built and tested with **no key and no database**: everything covered by `npm run check` — cleaning rules, schemas, export, vCard, sessions, passwords, the whole AI module (with mocked `fetch`), the tool loop, eval scoring, CSV import parsing. The mock AI server (`tools.md` §8) lets the pages be tried in a browser without spending free requests; it still needs a database.

### Order of work inside the AI module
1. `json.ts` and its tests (pure functions).
2. `client.ts` with mocked `fetch`: success, retries, error mapping.
3. `call-json.ts`, then `tool-loop.ts`.
4. The mock server.
5. Only then a real call: `npm run ai:models`, `npm run ai:smoke`.

---

## 4. Choosing the models

1. `npm run ai:models`. It needs no key and uses no free requests.
2. **Text model** (`AI_MODEL_TEXT`): must support `tools`. Prefer one that also lists `structured_outputs`, with a large context and good Arabic.
3. **Vision model** (`AI_MODEL_VISION`): must list `image` as an input. It needs no tool support. Structured outputs preferred.
4. For each candidate: set it in `.env.local`, run `npm run ai:smoke`, then `npm run eval:text -- --limit 3` or `npm run eval:photo -- --limit 3`.
5. If a model rejects `response_format` (HTTP 400 or 404), set `AI_JSON_MODE=prompt` and try again.
6. Keep the best one per feature, add up to 2 `AI_FALLBACK_MODELS`, run the full evals, and write the numbers in `plan.md` Progress.

`openrouter/free` works with no choice at all and is fine for a first run, but it may pick a different model for each request, so eval numbers are not repeatable. Pin real model ids before measuring.

Free models are removed without much notice. If the app starts answering "The AI model is not available", run `npm run ai:models` and choose again.

---

## 5. Running

```bash
cp .env.example .env.local        # fill in AUTH_SECRET, OPENROUTER_API_KEY, MONGODB_URI
npm install
npm run db:setup                  # indexes + Atlas Search index (once per database)
npm run users:add-admin -- admin --name "Your Name"
npm run ai:models                 # check the configured models
npm run dev                       # http://127.0.0.1:3000
```

Make `AUTH_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

Then, in the app: sign in as the admin, add departments and users (Users and Departments pages), and add contacts.

**Sample data:** `npm run db:seed -- --department "High Management" --sample`.

The local run is for testing only: it is bound to `127.0.0.1`, so no other computer or phone can reach it. Staff use the Vercel deployment.

**Test the production build before a deploy:** `npm run build && npm start` (still bound to `127.0.0.1`).

**Vercel (production):** import the repository, set every key of `.env.example` in the project settings, and pick a region next to the Atlas cluster (`vercel.json`). Free models can be slow: make sure the function duration for the extract and ask routes is long enough for `AI_TIMEOUT_MS` plus retries (check the limits of your Vercel plan).

**Phones:** open the HTTPS address and use the browser's "Add to Home Screen" / "Install app". The app needs a connection; it keeps no contacts on the device.

**Importing an existing list:** export it as CSV, then
```bash
npm run import:csv -- contacts.csv --department "Name" --dry-run   # shows the column mapping and what would happen
npm run import:csv -- contacts.csv --department "Name"
```
The report is written to `import-reports/`.

---

## 6. Living with the free allowance

| Action | Free requests |
|---|---|
| Quick search, table, edit, delete, export, manual add, import | 0 |
| Add from Text | 1 (2 if the first answer was invalid) |
| Add from Photo | 1 (2 if the first answer was invalid) |
| Ask AI | 1–3 |

- The cap is per OpenRouter account, shared by everyone using the app. More keys do not add capacity.
- Without credits (50 a day) the app suits a demo or one or two people. With the one-time $10 (1,000 a day) it suits a small office.
- Teach staff: quick search first, Ask AI only when quick search cannot answer.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Startup error naming `AI_MODEL_*` | Model id is not free | Use a `:free` id, or set `AI_ALLOW_PAID=true` on purpose |
| "The AI model is not available" / 404 "No endpoints found…" | Privacy setting blocks free endpoints, `AI_DATA_COLLECTION=deny` leaves no provider, or the model was removed | §2.1 step 2; set `allow`; run `ai:models` |
| "Today's free AI allowance is used up" | Daily cap | Wait for the reset, or the one-time $10 |
| "AI service is busy" often | 20-a-minute cap or a crowded free model | Add `AI_FALLBACK_MODELS`; try another model |
| 400 on every extraction | Model does not support `response_format`, or `max_tokens` is above its limit | `AI_JSON_MODE=prompt`; lower `AI_MAX_TOKENS` |
| Photo extraction stops with "Input is too large for one request" | Output cut off at `AI_MAX_TOKENS` | Raise `AI_MAX_TOKENS` if the model allows; fewer cards per photo |
| "The AI returned data in an unexpected format" often | Model too weak for the schema | Another model; a new prompt version with a worked example (`plan.md` §9.5) |
| Ask AI always "did not finish" | Model has no real tool calling, or answers in prose | Pick a model listing `tools`; check the server log for the `finish_reason` |
| Ask AI finds nothing although quick search does | Tool schema sent as strict, so the model fills every search field | Tool parameters must use `toProviderSchema(schema, { strict: false })` |
| Photos: wrong card count, mixed-up cards | Too many cards for the model | Fewer cards per photo; another vision model; the per-card upgrade |
| Photo requests time out | Slow free vision model | Raise `AI_TIMEOUT_MS`; lower the resize edge in `prepare-image.ts` |
| "This photo is too large to upload" | The host's request limit, usually a HEIC the browser could not shrink | Export the photo as JPG |
| 402 | Negative credit balance | Fix the balance in OpenRouter |
| Quick search returns nothing | Atlas Search index missing or still building | `npm run db:setup`; wait a minute |
| `eval:search` fails creating the search index | Atlas M0 allows 3 search indexes and `EVAL_DB` needs one | Delete an unused search index, or use Atlas Local for evals |
| "Database is not reachable" | Wrong `MONGODB_URI`, or the address is not allowed in Atlas | Check the connection string and Atlas network access |
| Everyone was signed out | `AUTH_SECRET` changed | Expected; sign in again |
| "Too many wrong tries" | 5 wrong passwords from this network address | Wait 15 minutes, or an admin resets the password |

Where to look: the server log has one `[ai]` line per call with the prompt id, the model that answered, latency, tokens and the error text. It never contains contact data.

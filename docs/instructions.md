# instructions.md — How to build and run the OpenRouter free-model version

Read `idea.md` first (what and why), then `plan.md` (the source of truth). `tools.md` has the env keys, commands and OpenRouter request formats. This file is the step-by-step.

OpenRouter screens, limits and free models change. Where this file and <https://openrouter.ai/docs> disagree, the OpenRouter docs win.

---

## 1. What you need

| Thing | Notes |
|---|---|
| Node.js 22+ and npm | Same as the live app |
| Git + a new empty repository | This version lives in its own repository |
| OpenRouter account | Free. No card needed for free models |
| MongoDB Atlas account (free M0) | Or Docker with Atlas Local, for a fully local test setup |
| The live `cards` repository | Only for the porting path (§3) |

## 2. One-time accounts setup

### 2.1 OpenRouter
1. Sign up at <https://openrouter.ai> and create an API key (Keys page). Put it in `.env.local` as `OPENROUTER_API_KEY`. Never commit it or paste it in chat.
2. Open the **privacy settings** of the account. Free endpoints are only used if the setting that allows free endpoints which may train on or publish prompts is turned on. If it is off, requests to free models fail with "No endpoints found matching your data policy".
3. Decide the privacy question in `idea.md` §7 **before** entering real contacts. Until then use test data only.
4. Optional: buy $10 of credits once. Free models stay free; the daily cap rises from 50 to 1,000 requests. Never let the balance go negative: free models then fail with 402.

### 2.2 MongoDB Atlas
1. Create a free M0 cluster in a region close to the users. Database `cards`.
2. Create a database user and allow your address (for Vercel: allow all addresses, `0.0.0.0/0`).
3. Put the connection string in `.env.local` as `MONGODB_URI`.

Fully local alternative: run Atlas Local in Docker (`mongodb/mongodb-atlas-local` image) and point `MONGODB_URI` at it. It includes Atlas Search. Plain MongoDB Community does not.

---

## 3. Path A — port from the live repository (recommended)

About 90% of the code is unchanged. Do the steps in order and keep `npm run check` green after each numbered step.

### Step 1 — Copy
1. Copy the live repository's files (not `.git`, `.next`, `node_modules`, `.env.local`, `local_v/`, `CLAUDE.md`, `README.md`) into this repository.
2. Keep this repository's `CLAUDE.md` and `docs/` (`plan.md`, `idea.md`, `instructions.md`, `tools.md`). Do not bring over the live app's `docs/PLAN.md` and `docs/documentation.md`, or keep them in `docs/original/` for reference.
3. `npm install`, then `npm run check` — it must be green before any change.

### Step 2 — Config and env
| File | Change |
|---|---|
| `src/lib/config.ts` | Remove `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_TIMEOUT_MS`. Add the AI keys of `tools.md` §4. Add the free-only check (`refine`): each of `AI_MODEL_TEXT`, `AI_MODEL_VISION` and every fallback is `openrouter/free` or ends in `:free`, unless `AI_ALLOW_PAID` is `true` |
| `.env.example` | Same keys, no values, one comment line each |
| `tests/unit/config.test.ts` | New keys; tests for the free-only check |
| `package.json` | Remove `@anthropic-ai/sdk`; add the `ai:models` script; rename the package |

### Step 3 — The AI module
Rename `src/modules/claude/` to `src/modules/ai/` and rewrite its files as described in `plan.md` §6 and `tools.md` §5–§7.

| File | Change |
|---|---|
| `client.ts` | Rewrite: `chat(body)` with `fetch`, timeout, retries, error mapping. Delete the `FALLBACK` beta |
| `json.ts` | New: `toProviderSchema`, `parseJsonLoose` |
| `call-json.ts` | Same exported types and signature (drop `effort`). Body: chat completions messages, `response_format` or prompt mode, loose parse, Zod, one retry |
| `tool-loop.ts` | Same signature (drop `effort`). Body: OpenAI-style `tools` / `tool_calls` / `role: "tool"`; last round `tool_choice: "none"` |
| `log.ts` | Keep. `stopReason` holds `finish_reason` |

Mapping from the Anthropic code to OpenRouter:

| Anthropic (live app) | OpenRouter (this version) |
|---|---|
| `client.beta.messages.create({ system, messages })` | `POST /chat/completions` with `messages: [{ role: "system" }, …]` |
| `output_config.format` (`zodOutputFormat`) | `response_format: { type: "json_schema", json_schema: { name, strict, schema } }` |
| `output_config.effort`, `betas`, `fallbacks` | removed (optional `models: [...]` for fallbacks) |
| image block `{ type: "image", source: { type: "base64", media_type, data } }` | `{ type: "image_url", image_url: { url: "data:<type>;base64,<data>" } }` |
| tool `{ name, description, input_schema }` | `{ type: "function", function: { name, description, parameters } }` |
| `tool_choice: { type: "auto" \| "none" }` | `tool_choice: "auto" \| "none"` |
| `tool_use` block `{ id, name, input }` (object) | `message.tool_calls[] { id, function: { name, arguments } }` (`arguments` is a JSON **string**) |
| one user message with `tool_result` blocks, `is_error` | one `{ role: "tool", tool_call_id, content }` message per call; errors are plain text |
| `stop_reason`: `end_turn`, `tool_use`, `max_tokens`, `refusal` | `finish_reason`: `stop`, `tool_calls`, `length`, `content_filter` |
| `usage.input_tokens` / `output_tokens` | `usage.prompt_tokens` / `completion_tokens` |
| `Anthropic.RateLimitError` etc. | HTTP status + `error` body (`tools.md` §7.6) |

### Step 4 — Callers (import paths and wording only)
| File | Change |
|---|---|
| `src/modules/extraction/structure-text.ts`, `extract-photo.ts` | Import from `@/modules/ai/call-json`. Warning text "Claude counted…" → "The AI counted…" |
| `src/modules/search/ask.ts`, `tools.ts` | Import from `@/modules/ai/tool-loop`. Comments: "Claude" → "the AI" |
| `src/modules/extraction/prepare-image.ts` | Rename `MAX_BASE64_BYTES` to `MAX_AI_IMAGE_BYTES` and fix its comment: 5 MB was Anthropic's per-image limit. Keep 5 MB to start; lower it if a chosen vision model rejects large images |
| `src/modules/extraction/prompts/*.ts`, `src/modules/search/prompts/*.ts` | Type import path only. **Do not change prompt text or ids** |
| `src/modules/contacts/contact.schema.ts` and other comments | "Claude" → "the AI" |
| API routes for extract and ask | Pass `TOO_MANY_REQUESTS` through `fail()` (it already maps to 429) |
| Pages: Add from Text, Add from Photo, `SearchBar` | Show the three AI failure messages. New: an **Add manually** button on both Add pages (an empty `ReviewTable` block saved with `source: "manual"`); the live app has no such button |

Check nothing is left: `grep -ri "anthropic\|claude" src scripts tests` should return only intended mentions (none in `src/`).

### Step 5 — Tests and mock server
| File | Change |
|---|---|
| `tests/unit/call-json.test.ts`, `ask-loop.test.ts` | Mock `fetch` instead of the Anthropic client; add the cases of `plan.md` Phase 2 |
| new `tests/unit/ai-client.test.ts`, `ai-json.test.ts` | Retries, error mapping, schema stripping, loose parsing |
| `tests/mock-claude/server.mjs` → `tests/mock-ai/server.mjs` | Answer `POST /chat/completions` in chat completions shape (`tools.md` §8) |
| `tests/unit/extraction-review.test.ts`, `tests/db/access.test.ts` | Update the mocked module path |

### Step 6 — Scripts
| File | Change |
|---|---|
| new `scripts/ai-models.ts` | `GET /models` → table of free models: id, context length, image input, tools, structured outputs. Then check the configured models and print PASS / FAIL per feature |
| `scripts/ai-smoke.ts` | Unchanged logic; print the model that answered |
| `scripts/eval-*.ts` | Keep what they do today: the name filter on text and photo, and for search the separate `EVAL_DB` database (default `cards_eval`, emptied on each run) and `--quick-only`. Add: `--limit N`, pause between calls, print configured + answering model, JSON mode, retries, 429s; API failures listed separately |

### Step 7 — Docs and branding
`README.md`: replace the Anthropic setup with §2.1, the env table and the model selection steps. Decide whether to keep the AUIB name and logos (`idea.md` §7).

### Step 8 — Verify (then follow `plan.md` Phases 3–7 checks)
1. `npm run check` green.
2. Mock run: start `node tests/mock-ai/server.mjs`, run the app with `OPENROUTER_BASE_URL=http://127.0.0.1:4010`, and try text, photo and Ask in the browser.
3. `npm run ai:models`, then `npm run ai:smoke` with the real key.
4. Model selection (§5), then the evals. Record everything in `plan.md` Progress.

---

## 4. Path B — build from zero

Follow `plan.md` §9 phase by phase. Use the live repository as a reference for behaviour, not as a source to paste from. The order differs from the live app's history on purpose: accounts and the department scope come in Phase 1, so no contacts code is ever written without a scope.

---

## 5. Choosing the models

1. `npm run ai:models`. It needs no key and uses no free requests.
2. **Text model** (`AI_MODEL_TEXT`): must support `tools`. Prefer one that also lists `structured_outputs`, with a large context and good Arabic.
3. **Vision model** (`AI_MODEL_VISION`): must list `image` as an input. It needs no tool support. Structured outputs preferred.
4. For each candidate: set it in `.env.local`, run `npm run ai:smoke`, then `npm run eval:text -- --limit 3` or `npm run eval:photo -- --limit 3`.
5. If a model rejects `response_format` (HTTP 400 or 404), set `AI_JSON_MODE=prompt` and try again.
6. Keep the best one per feature, add up to 2 `AI_FALLBACK_MODELS`, run the full evals, write the numbers in Progress.

`openrouter/free` works with no choice at all and is fine for a first run, but it picks a different model from request to request, so eval numbers are not repeatable. Pin real model ids before measuring.

Free models are removed without much notice. If the app starts answering "The AI model is not available", run `npm run ai:models` and pick again.

---

## 6. Running

```bash
cp .env.example .env.local        # fill in AUTH_SECRET, OPENROUTER_API_KEY, MONGODB_URI
npm install
npm run db:setup                  # indexes + Atlas Search index (once per database)
npm run users:add-admin -- admin --name "Your Name"
npm run ai:models                 # check the configured models
npm run dev                       # http://127.0.0.1:3000
```

Make `AUTH_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

Production on one machine: `npm run build && npm start`.

Vercel: import the repository, set every key of `.env.example` in the project settings, pick a region next to the Atlas cluster. Free models are slower than Claude: set the function duration for the extract and ask routes high enough for `AI_TIMEOUT_MS` plus retries (check the limits of your Vercel plan).

---

## 7. Living with the free allowance

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

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Startup error naming `AI_MODEL_*` | Model id is not free | Use a `:free` id, or set `AI_ALLOW_PAID=true` on purpose |
| "The AI model is not available" / 404 "No endpoints found…" | Privacy setting blocks free endpoints, `AI_DATA_COLLECTION=deny` leaves no provider, or the model was removed | §2.1 step 2; set `allow`; run `ai:models` |
| "Today's free AI allowance is used up" | Daily cap | Wait for the reset, or the one-time $10 |
| "AI service is busy" often | 20-a-minute cap or a crowded free model | Add `AI_FALLBACK_MODELS`; try another model |
| 400 on every extraction | Model does not support `response_format`, or `max_tokens` is above its limit | `AI_JSON_MODE=prompt`; lower `AI_MAX_TOKENS` |
| Photo extraction stops with "Input is too large for one request" | Output cut off at `AI_MAX_TOKENS` | Raise `AI_MAX_TOKENS` if the model allows; fewer cards per photo |
| `eval:search` fails creating the search index | Atlas M0 allows 3 search indexes and `EVAL_DB` needs one | Delete an unused search index, or use Atlas Local for evals |
| "The AI returned data in an unexpected format" often | Model too weak for the schema | Another model; a new prompt version with a worked example (`plan.md` §7) |
| Ask AI always "did not finish" | Model has no real tool calling, or answers in prose | Pick a model listing `tools`; check the server log for the `finish_reason` |
| Ask AI finds nothing although quick search does | Tool schema sent as strict, so the model fills every search field | Tool parameters must use `toProviderSchema(schema, { strict: false })` |
| Photos: wrong card count, mixed-up cards | Too many cards for the model | Fewer cards per photo; another vision model; the per-card upgrade |
| Photo requests time out | Slow free vision model | Raise `AI_TIMEOUT_MS`; lower the resize edge in `prepare-image.ts` |
| 402 | Negative credit balance | Top up or fix the balance in OpenRouter |
| Quick search returns nothing | Atlas Search index missing or still building | `npm run db:setup`; wait a minute |

Where to look: the server log has one `[ai]` line per call with the prompt id, the model that answered, latency, tokens and the error text. It never contains contact data.

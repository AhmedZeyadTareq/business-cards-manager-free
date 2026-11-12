# plan.md — Business Card System, OpenRouter free-model version (Next.js + OpenRouter + MongoDB Atlas)

> This file is the source of truth.
> It describes the live Business Cards Manager **as built**, with the AI layer replaced. Background: `idea.md`. Wire formats, env keys and commands: `tools.md`. Setup and porting steps: `instructions.md`.

## 1. Approach
**Plain modules and functions. A free model is called through the OpenRouter API with `fetch`.**

- No agent framework and no AI SDK. Each feature is a module with simple exported functions.
- The model does the intelligence: structuring text, reading cards, understanding search questions.
- The code does the plumbing: UI, API routes, MongoDB, validation, and guarding against weak model output.
- Free models are weaker and less reliable than Claude. The code treats every AI reply as untrusted text, and every feature still works (or fails with a clear message) when the AI is slow, wrong or out of free requests.

```
  Explore     ──┐                      ┌─ search/     ─┐─▶ ai/ (OpenRouter, fetch)
  Add: Text   ──┼─▶ proxy ─▶ API routes ─▶ modules ─ extraction/ ─┤
  Add: Photo  ──┘   (session)  (requireAccess)   └─ contacts/   ─┘─▶ db/ (MongoDB Atlas)
```

---

## 2. Pages

| Page | Route | What happens |
|---|---|---|
| Login | `/login` | Username + password. |
| Explore | `/` | Search box first: **Quick search** (instant, no AI) while typing + **Ask AI** (natural language). Overview strip (total, added this month / last 7 days, contacts per sector — click to filter), hidden during a search. Table with filters (Added by, City, Sector, dates; Department for High Management); cards when there is no room. View / edit / delete. **Add to phone contacts** (.vcf). Export CSV of what is on screen. |
| Add from Text | `/add/text` | Paste unstructured lines → AI returns structured contacts → review / edit → **Save**. |
| Add from Photo | `/add/photo` | Upload or take 1 photo with one or many cards → AI returns one contact per card → review / edit → **Save**. |
| Team | `/team` | Static list of the people behind the app. No API calls. |
| My account | `/account` | Change own password. |
| Admin | `/admin/users`, `/admin/departments`, `/admin/activity` | Admins only: users, departments, activity log. |

**Two search modes:**
- **Quick search:** typing → results in < 300 ms. No AI, no free requests used. Enter opens the first match. 20 results at a time with **Show more**, up to 1,000. Rules, in this order:
  - Fewer than 2 characters: no search.
  - Only digits and phone punctuation, with 3+ digits: **mobile numbers only** (`_mobiles`, part of a number is enough; a leading `0`, `964` or `00964` is ignored). Office and fax numbers in `Notes` are not found this way.
  - Contains `@`: **emails only** (`_emails`, part of an address is enough).
  - Anything else: Atlas Search (autocomplete + fuzzy) over name, company, position, city, notes and email. Same-script matching only (احمد finds أحمد, but not Ahmed).
  - A search always covers all contacts in scope and ignores the table filters; a notice names the filters that do not apply.
- **Ask AI:** the **Ask AI** button, or Enter when quick search has no matches → AI tool loop → one-line answer + contacts. Handles cross-script (محمد ↔ Mohammed), synonyms, dates. Uses up to 3 free requests per question.

**When the free AI allowance is used up:** Ask AI and both Add pages show "Today's free AI allowance is used up." Quick search, the table, edit, delete, export and manual add are unaffected. Add pages offer **Add manually** (an empty review block, `source: "manual"`).

---

## 3. Fixed Decisions

| Area | Decision |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript strict |
| Hosting | Local machine bound to `127.0.0.1`, or Vercel. Photos over 4 MB are shrunk in the browser (Vercel's 4.5 MB request limit). |
| Access | Per-user username + password (scrypt, Node `crypto`, no auth library), signed session cookie keyed by `AUTH_SECRET`. One database: each contact has a server-set `DepartmentId`; every contacts read takes a required scope. |
| Code style | Modules + plain exported functions. No classes, no agent framework. |
| UI | Tailwind + shadcn/ui; sidebar layout; English-only labels; `dir="auto"` on value cells and inputs. `English / العربية` values show one line per language. Lists never scroll sideways. Touch targets ≥ 44 px. |
| **AI provider** | **OpenRouter** chat completions API (`/api/v1/chat/completions`), OpenAI-compatible JSON, called with built-in `fetch` from `modules/ai/client.ts`. No SDK. |
| **Models** | Env only: `AI_MODEL_TEXT` (text + Ask AI; must support tool calling) and `AI_MODEL_VISION` (photos; must accept images). Default `openrouter/free` (OpenRouter picks a free model). Pin specific `:free` models once the evals have chosen them. Optional `AI_FALLBACK_MODELS`. |
| **Free only** | `config.ts` rejects a model id that is not `openrouter/free` and does not end in `:free`, unless `AI_ALLOW_PAID=true`. |
| **Structured output** | `AI_JSON_MODE=schema`: `response_format: { type: "json_schema", strict: true }` from the Zod schema + `provider.require_parameters` + the `response-healing` plugin. `AI_JSON_MODE=prompt`: schema written into the prompt. Both: tolerant JSON parsing, then Zod, then one corrective retry. |
| **Retries and limits** | `client.ts`: timeout from `AI_TIMEOUT_MS`; up to 2 retries on per-minute 429, 408, 5xx and network errors (honours `Retry-After`); never retries the daily-cap 429. |
| **Privacy** | Test data only until the owner decides (`idea.md` §5). `AI_DATA_COLLECTION` = `allow` or `deny` is sent as `provider.data_collection`. Prompt and response bodies are never logged. |
| Database | MongoDB Atlas Free (M0), database `cards`, collection `contacts`; region close to the users. Atlas Local (Docker) for tests. |
| Driver | Official `mongodb` driver (no ORM) |
| Search | Atlas Search index `contacts_search` (autocomplete + fuzzy, `lucene.arabic` + `lucene.standard`, custom `fold` analyzer) + normal filters |
| Images | Server: real type detected from the file's first bytes (the browser's type is not trusted); HEIC → JPEG (`heic-convert`), then `sharp` auto-rotate and resize to JPEG. Steps down (2000 px q85 → 2000 q72 → 1600 q72 → 1280 q65) until the base64 is under `MAX_AI_IMAGE_BYTES` (a constant in `prepare-image.ts`, 5 MB to start: the live app's value, which was Anthropic's limit; lower it if a chosen model rejects large images). Sent as a base64 data URL. |
| Next.js config | `next.config.ts` as in the live app: `cacheComponents`, `partialPrefetching`, `experimental.proxyClientMaxBodySize: "25mb"` (with `proxy.ts` active, larger bodies are cut off; keep it above `MAX_IMAGE_MB`), security headers on every response (`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`), and `Cache-Control: no-cache` for `/sw.js` so updates reach installed apps. |
| **Output size** | `AI_MAX_TOKENS` (default 8000) caps `max_tokens` on every request. Many free models allow less output than Claude and reject a larger value. |
| Prompts | Versioned TypeScript files exporting `{ id, text }` (`*.vN.ts`). Provider-neutral wording. |
| Validation | Zod v4: one contact schema for AI output, API input and DB writes. `z.toJSONSchema()` for tool and output schemas. |
| Writes | The AI never writes to the DB. Saving happens only via `POST /api/contacts` after user review. |
| Quality | ESLint + Prettier + `tsc --noEmit` + Vitest: `npm run check`. GitHub Actions runs it on every push. |
| Version control | Git; one commit per approved phase |

---

## 4. Folder Structure

```
.env.example                         → all env keys, no values
CLAUDE.md, AGENTS.md                 → agent instructions
docs/                                → plan.md, idea.md, instructions.md, tools.md

src/
  instrumentation.ts                 → validates env at server startup
  proxy.ts                           → session cookie genuine and unexpired? else /login
  app/
    login/page.tsx
    (app)/page.tsx                   → Explore
    (app)/add/text/page.tsx, add/photo/page.tsx
    (app)/team, account, admin/users, admin/departments, admin/activity
    manifest.ts                      → PWA manifest
    api/
      search/route.ts                → GET ?q=&limit=  → quick search (no AI)
      ask/route.ts                   → POST { question } → { answer, contacts }
      extract/text/route.ts          → POST { text }     → { contacts }
      extract/photo/route.ts         → POST image        → { cardCount, contacts, warning? }
      contacts/route.ts              → GET list · POST { source, contacts[] }
      contacts/[id]/route.ts         → GET · PATCH · DELETE
      contacts/[id]/vcard/route.ts   → GET → .vcf
      contacts/export/route.ts       → GET ?ids= | ?q= | table filters → CSV
      contacts/values/route.ts       → GET ?field= distinct City / Sector / Company
      contacts/creators/route.ts     → GET people who added contacts in scope
      auth/login, auth/logout
      me/route.ts, me/password
      admin/users[/id], admin/departments[/id], admin/activity

  modules/
    ai/                              → THE ONLY CODE THAT CALLS OPENROUTER
      client.ts                      → chat(body): fetch, auth, fallbacks, timeout, retries, error mapping
      call-json.ts                   → callJson({ prompt, input, schema, image?, maxTokens? })
      tool-loop.ts                   → runToolLoop(): bounded tool loop used by search/ask
      json.ts                        → toProviderSchema(schema), parseJsonLoose(text)
      log.ts                         → one line per call: prompt id, model, latency, tokens, attempt

    accounts/                        → account.schema, access (requireAccess), scope, users.repo,
                                       departments.repo, login, login-attempts, password, session
    audit/audit.repo.ts              → writeAudit, listAudit
    contacts/
      contact.schema.ts              → ContactInput, Contact, SECTORS, SOURCES — single source of truth
      contacts.repo.ts               → listContacts, quickSearch, searchContacts, getContact,
                                       getContactsByIds, insertContacts, updateContact, deleteContact,
                                       listValues, listCreators, listAllContacts, findDuplicates
      normalize.ts, export.ts, vcard.ts, import.ts
    extraction/
      structure-text.ts              → structureText(departmentId, text)
      extract-photo.ts               → extractPhoto(departmentId, file)
      prepare-image.ts
      prompts/                       → structure-text.vN.ts, extract-photo.vN.ts, sector-rules.vN.ts
    search/
      ask.ts                         → ask(scope, question)
      tools.ts                       → tool definitions + handlers
      prompts/search.vN.ts
    db/                              → mongo.ts, setup.ts, search-index.json
    shared/                          → errors.ts (AppError), api-response.ts (ok / fail)

  components/                        → ContactTable, ContactForm, ContactFields, ReviewTable, SearchBar,
                                       Overview, AppSidebar, Toast, MeProvider, AdminOnly, …
  lib/                               → config.ts, api.ts, bilingual.ts, shrink-image.ts, unsaved.ts, scroll.ts

public/                              → sw.js, offline.html, icons

scripts/
  ai-models.ts                       → NEW: free models by ability; checks the configured models
  ai-smoke.ts                        → one real call
  eval-text.ts, eval-photo.ts, eval-search.ts, eval-score.ts   → take --limit N, pause between calls
  seed.ts, import-csv.ts, migrate.ts, users-add-admin.ts, make-photo-fixtures.ts

tests/
  mock-ai/server.mjs                 → fake chat completions API (OPENROUTER_BASE_URL)
  unit/                              → mocked fetch; config, normalize, schema, call-json, tool loop, json, …
  db/                                → integration tests (`npm run test:db`, not part of `check`)
  fixtures/                          → text/, photos/, search/questions.json
```

**Rules**
- Pages call API routes only.
- API routes are thin: `requireAccess()` → parse input with Zod → one module function → `ok()` / `fail()`.
- Only `modules/ai/` calls OpenRouter. Nothing outside it names a provider, a model or a wire format.
- Only `modules/db/`, `contacts.repo.ts`, `modules/accounts/` and `modules/audit/` touch MongoDB.
- Every contacts read takes a `Scope`; every write takes a `Writer`. Both come from `requireAccess()`, never from the request body or the AI.
- Modules never import from `app/` or `components/`.
- A prompt change = new version file + re-run its eval. A model change = re-run the evals.
- Adding a feature = new module function + prompt + route.

---

## 5. Contact Document

```json
{
  "_id": "ObjectId",
  "FullName": "", "Position": "", "Mobile": "", "Company": "", "City": "", "Email": "",
  "Sector": "Professional & Other Contacts",
  "Notes": "",
  "Source": "text | photo | manual | import",
  "DepartmentId": "ObjectId",
  "CreatedBy": "ObjectId | null", "UpdatedBy": "ObjectId | null",
  "_mobiles": ["+9647XXXXXXXXX"], "_emails": ["a@b.com"],
  "CreatedAt": "Date", "UpdatedAt": "Date"
}
```
- The 8 business fields are strings (max 300 characters; `Notes` 2,000); empty when unknown — **never invented**. `Sector` is never empty.
- `Mobile`: international format; several separated by ` | `. Arabic-Indic digits → 0-9. A number that cannot be formatted with confidence is kept as written with a "check this number" hint.
- Office / landline / fax numbers → `Notes` (labelled).
- `Email`: lowercase; several separated by ` | `. An invalid email blocks the save until fixed or cleared (CSV import moves it to `Notes`).
- `Sector`: exactly one of `SECTORS`: `Ministries & Government, Businesses & Financial Institutions, Embassies & International Organizations, Universities & Education, NGOs & Civil Society, Professional & Other Contacts`. Missing or unclear → the last one (`DEFAULT_SECTOR`).
- `Source` comes from the client (`SOURCES` enum, validated). `CreatedAt`, `UpdatedAt`, `_mobiles`, `_emails`, `DepartmentId`, `CreatedBy`, `UpdatedBy` are set by the server only.
- `ContactInput` (8 fields) is what the AI and users send; `Contact` adds server fields.
- **Free-model guard:** AI output for a field longer than its limit, or a `Sector` outside the list, fails Zod and triggers the one retry; it never reaches the review table unvalidated.

**Other collections:** `departments { name, isHighManagement, active, createdAt }`, `users { username, name, passwordHash, departmentId, role, active, sessionVersion, … }`, `login_attempts` (TTL), `audit_log`.

**Indexes:** Atlas Search `contacts_search` (`FullName`, `Company`, `Position` autocomplete + string; `City`, `Notes`, `Email`, `Mobile` string; `Sector` string + token; `CreatedAt` date; `DepartmentId` objectId filter in both `$search` and `$searchMeta`). Normal: `City`, `Sector`, `Company`, `CreatedAt`, `{ DepartmentId, CreatedAt }`, `_emails`, `_mobiles`; unique `users.username`; unique `departments.name` (case-insensitive); `audit_log.at`; TTL on `login_attempts.expiresAt`.

---

## 6. Module Functions

### `ai/client.ts` — `chat(body)`
1. Build the request: model (or `models` when fallbacks are set), `provider { require_parameters, data_collection }`, the caller's `messages`, `tools`, `response_format`, and `max_tokens` = the caller's value, never above `AI_MAX_TOKENS`.
2. `fetch` with `AbortSignal.timeout(AI_TIMEOUT_MS)`.
3. Retry up to 2 times on per-minute 429, 408, 5xx, network errors. Wait `Retry-After` if present, else 2 s then 5 s.
4. A body containing `error` is a failure even with HTTP 200.
5. Map failures to `AppError` with a safe message (`tools.md` §7.6): `TOO_MANY_REQUESTS` for 429, otherwise `AI_FAILED`. Log the raw error server-side only.
6. Return `{ message, finishReason, model, usage }`.

### `ai/call-json.ts` — `callJson({ prompt, input, schema, image?, maxTokens? })`
1. Model: `AI_MODEL_VISION` if `image`, else `AI_MODEL_TEXT`.
2. Messages: system = prompt text (+ the schema instruction in `prompt` mode); user = text, plus an `image_url` data URL part when there is an image.
3. `schema` mode: `response_format` from `toProviderSchema(schema)`, `response-healing` plugin.
4. `chat()`. `finish_reason: "length"` → `AI_FAILED` "Input is too large for one request. Try fewer items at a time." `content_filter` → `AI_FAILED` "The AI declined to process this input." Neither is retried.
5. `parseJsonLoose(content)` → Zod.
6. On invalid JSON or a Zod failure: retry **once** — append the assistant turn and a user message listing the problems ("Return the complete corrected JSON").
7. Log each call. Return the typed object or throw `AppError(AI_FAILED)`.

### `ai/tool-loop.ts` — `runToolLoop({ prompt, userText, tools, final, maxRounds = 3 })`
Round = one `chat()` call.
1. Rounds 1 … max−1: `tool_choice: "auto"` with the tools + the final tool. Run **every** tool call of the turn; answer each with a `role: "tool"` message. Arguments are a JSON string: parse, then validate with the tool's Zod schema; a bad or unknown call gets an error sentence as its result.
2. A valid `final_answer` call ends the loop, even next to other calls.
3. A turn with no tool calls: if its text parses as a valid final answer, accept it; otherwise ask "Finish by calling final_answer."
4. Last round: `tool_choice: "none"`, ask for the final answer as JSON (`response_format` in `schema` mode), parse loosely, validate. A `final_answer` tool call is also accepted.
5. Nothing valid → `AppError(AI_FAILED)` "AI search did not finish. Try rephrasing the question."

### `ai/json.ts`
- `toProviderSchema(zodSchema, { strict })`: `z.toJSONSchema()` → remove `$schema`, `maxLength`, `minimum`, `maximum`, `format`, `pattern`. Zod re-checks what was removed.
  - `strict: true` — **only for `response_format`** (contacts, photo result, final answer): also set `additionalProperties: false` and every property `required` on every object.
  - `strict: false` — **for tool `parameters`**: optional fields stay optional. Never make `search_contacts` fields required: the model would then fill every field and searches would match nothing.
- `parseJsonLoose(text)`: trim, drop ``` fences, take the first `{` to the last `}`, `JSON.parse`. Throws on failure.

### `extraction/*`
- `structureText(departmentId, text)` → reject empty / over-limit text → `callJson` → `cleanForReview` each → drop all-empty contacts → `findDuplicates` → return.
- `extractPhoto(departmentId, file)` → validate type (jpg / png / webp / heic) and size → `prepareImage` → `callJson` with image (asks for 24,000 output tokens; `client.ts` caps it at `AI_MAX_TOKENS`) → `cardCount !== contacts.length` gives a warning, not an error ("The AI counted N cards but read M") → `cleanForReview` → `findDuplicates` → return.

### `contacts.repo.findDuplicates(departmentId, contacts)`
Marks a contact with `duplicateOfId` when a saved contact **in the same department** shares a mobile or email, and `duplicateInBatch` when an earlier one in the batch does. Review shows **Skip / Save anyway**; duplicates start on Skip.

### `search/ask.ts` — `ask(scope, question, today)`
Validate (1–500 characters) → `runToolLoop` with the search prompt, `Today is YYYY-MM-DD. Question: …`, `searchTools(scope)`, `finalAnswerTool` → `getContactsByIds(scope, contactIds)` (keeps the AI's order; drops invalid, unknown and out-of-scope ids) → `{ answer, contacts, rounds }`.

### `search/tools.ts`
See `tools.md` §6. The scope is fixed in the handlers and is never a tool input.

### `contacts/export.ts`, `vcard.ts`, `normalize.ts`, `import.ts`
Unchanged from the live app: export follows the screen — `ids` (Ask results), `q` (every quick search match), otherwise the table filters — with UTF-8 BOM, RFC 4180 quoting and a formula-injection guard, a Department column for High Management, and an `audit_log` entry per export; vCard 3.0; phone and email cleaning; CSV import (maps columns and old sector names, skips duplicates, moves invalid emails to `Notes`).

### Accounts and access (`accounts/`, `audit/`, `proxy.ts`)

| Role | Search + view | Add + edit | Delete | Export CSV | Manage departments + users |
|---|:-:|:-:|:-:|:-:|:-:|
| **Viewer** | Own scope | — | — | — | — |
| **Editor** | Own scope | Add to own department, edit in own scope | Own scope | Own scope | — |
| **Admin** (High Management only) | Everything | Add to own department, edit everything | Everything | Everything | Yes |

"Own scope" = the person's department, or every department for High Management.

**Sessions**
- Signed cookie, valid 30 days. `proxy.ts` checks only that it is genuine and unexpired.
- Every API route calls `requireAccess(permission?)`, which reads the user and department from the database, so a deactivation, password reset or role change applies on the next request.
- A password change, admin reset or deactivation raises `sessionVersion`, which ends that person's other sessions.
- When the database refuses a session (password changed or reset, user or department inactive), `requireAccess` **deletes the cookie**. A role refusal keeps it. On any 401 the browser also calls `/api/auth/logout` before going to `/login`. Without these two, an old session loops between `/login` and the app.
- Unknown username, wrong password and inactive account get the same answer.
- 5 wrong passwords from one network address lock that address out of the username for 15 minutes (`TOO_MANY_REQUESTS`). An admin password reset lifts the lock.

**Admin rules**
- Admins must be in High Management. Exactly one department has `isHighManagement: true`.
- Nobody can remove their own admin access or deactivate themselves; the last active admin always stays.
- People and departments are deactivated, never deleted, so the activity log stays readable. People in an inactive department cannot sign in.

**The access rule**
- Every read function in `contacts.repo.ts` takes the scope as a **required** argument, so a call without one fails typecheck.
- New contacts go to the signed-in user's department, read on the server. Editing does not move a contact.
- A contact outside the user's scope returns `NOT_FOUND`, not "forbidden", so its existence is not revealed.
- A contact with no `DepartmentId` is visible only to High Management.
- `DepartmentId`, `CreatedBy` and `UpdatedBy` in a request body are ignored.

Every place contacts can come out must apply the scope:

| Place | Function | Risk if missed |
|---|---|---|
| Table and overview figures | `listContacts` | Hidden contacts and totals |
| Quick search: phone, email and text branches, and the total count | `quickSearch` (`$search` and `$searchMeta` both) | Hidden contacts, or a count that reveals them |
| Ask AI | `searchContacts`, `listValues`, `getContactsByIds` | Hidden contacts in AI answers |
| CSV export | `listAllContacts` | Hidden contacts in the file |
| Filter lists and sector bars | `listValues`, `listCreators` | Company and city names, or who added contacts, revealed |
| Opening by id, vCard, edit, delete | `getContact`, `updateContact`, `deleteContact` | Access by direct link |
| Duplicate warning | `findDuplicates` (own department only) | "Already saved: name" reveals a hidden person |

**Activity log:** `audit_log` entries for create, update (with the old values), delete and export; read-only list at `/admin/activity`.

---

## 7. Prompt Requirements

Start from the live app's current prompts, copied unchanged except for the type import and any provider name in the text: **structure-text.v3**, **extract-photo.v3**, **search.v2**, **sector-rules.v1**. Keep their ids so results can be compared with the live app's numbers.

- **structure-text:** split messy lines into contacts; group lines of the same person; map to the 8 fields; office / fax / address / website → `Notes` (labelled); `City` only from a location, never from a company name; `Sector` always one of the 6 using the sector rules; never invent.
- **extract-photo:** count all cards first; one contact per card in reading order; Arabic, English and bilingual cards (`Arabic / English`), rotation, uneven light; logo text as `Company` if there is no other; same `City`, `Sector` and `Notes` rules; `cardCount` must equal `contacts.length`.
- **search:** understand intent; resolve relative dates against today; search spelling variants (Arabic ↔ English, typos, partial names) and synonyms; `list_values` for exact stored names; at most 2 search rounds, so search broadly in parallel; finish with `final_answer` in the question's language; never make up ids.

**If a free model misses a target,** make a new version, one change at a time, and re-run the eval. Changes that usually help smaller models:
1. One short worked example of input → output JSON.
2. For Ask: "Call at most 3 tools per turn" and an explicit example of a `final_answer` call (some models answer in prose instead).
3. For photos: "Read one card at a time; do not continue a card's text into the next card."
4. Shorter prompts: remove rules the evals show the model already follows.

---

## 8. Evals

`scripts/eval-score.ts` holds one comparison rule for all evals:
- Both values pass through `cleanContact` first.
- Text fields: case-insensitive, whitespace-collapsed, Arabic-normalized exact match.
- `Mobile` / `Email`: same set of normalized values.
- Bilingual values: correct if all expected parts appear.
- Empty expected + empty actual = correct. An invented value = wrong.
- Reports per-field accuracy, overall accuracy and the misses.

**As in the live app**
- `eval:text` and `eval:photo` take an optional name filter (`npm run eval:photo -- p07` runs only fixtures whose name contains `p07`).
- `eval:search` uses its **own database** (`EVAL_DB`, default `cards_eval`), never `MONGODB_DB`. It deletes every contact there, loads the 30 sample contacts, builds the indexes and waits for Atlas Search before asking. `--quick-only` skips Ask (no AI requests). On Atlas M0 this database needs one of the 3 allowed search indexes.
- Fixtures: 10 text samples, 10 photos (1, 4, 8, 12 cards), and `search/questions.json` with 20 Ask questions + 12 quick search queries.

**Added for free models**
- Every report prints the configured model **and the model that answered** (from the response), the JSON mode, and the counts of retries, 429s and failures.
- `--limit N` runs the first N fixtures (after the name filter). A pause between calls keeps under 20 requests a minute.
- A fixture that fails on an API error counts as failed, not skipped, and is listed separately from wrong answers.
- Budget: text 10, photo 10, search up to 60 requests. Not all on one day without the $10 credits.

---

## 9. Phases

### Execution Rules
- One phase at a time, in order. Finish only when all **Done when** checks pass and `npm run check` is green.
- After each phase: update **Progress**, commit, stop, report (built / tested / numbers / issues), wait for approval.
- No changes to Fixed Decisions or Folder Structure without asking.
- Two ways to do the work: **port** (copy the live repository, then change the AI layer — `instructions.md` §3) or **build from zero**. Phases and checks are the same; with the port, Phases 0, 1, 4–7 are mostly "copy, rename, verify".

### Phase 0 — Setup
1. New repository; `.gitignore` includes `.env*` except `.env.example`.
2. Next.js 16 app (TS strict, Tailwind, shadcn/ui, ESLint, Prettier). Install `zod`, `mongodb`, `sharp`, `heic-convert`, `vitest`, `tsx`. **No AI SDK.**
3. Folder structure; `lib/config.ts` with the keys of `tools.md` §4, including the free-only check; `.env.example`; `instrumentation.ts`.
4. `dev` / `start` bind to `127.0.0.1`. `next.config.ts` as in Fixed Decisions (body limit, security headers, `sw.js` header). GitHub Actions running `npm run check`.
5. `shared/errors.ts`, `shared/api-response.ts`. Docs copied into `docs/`, `CLAUDE.md` at the root.

**Done when:** app runs on localhost only; missing or invalid env stops startup with a clear error; a paid model id is refused unless `AI_ALLOW_PAID=true`; `npm run check` passes.

### Phase 1 — Accounts and data
1. Atlas cluster (manual step), `db/mongo.ts`, `db/setup.ts`, `search-index.json`.
2. `accounts/` (users, departments, roles, sessions, lockout), `audit/`, `proxy.ts`, login page, `users:add-admin`.
3. `contact.schema.ts`, `normalize.ts`, `contacts.repo.ts` (every read takes a scope), `export.ts`, `vcard.ts`.
4. Contact, search, auth, me and admin routes.
5. Unit tests (normalize, export, accounts, schema).
6. DB tests with three departments (High Management, A, B) sharing some of the same phone numbers and names:
   - For every row of the scope table: A sees only A, nothing from B or High Management; High Management sees all.
   - Opening, editing or deleting another department's contact returns `NOT_FOUND` and changes nothing.
   - A High Management editor can edit a contact in A (it stays in A) and delete it.
   - The same phone number in A and B gives no duplicate warning across departments; within A it does.
   - `DepartmentId` sent in a save or edit request is ignored.
   - Each role can do only what the roles table allows, enforced at the API, not only by hidden buttons.
   - A deactivated user is refused on the next request and the cookie is deleted; an unknown username gets the same message as a wrong password.
   - 5 wrong passwords lock the username for that address; a password reset lifts the lock and ends the user's sessions; an inactive department's people cannot sign in.
   - Admins must be in High Management; nobody can remove their own admin access; the last active admin stays.

**Done when:** contact routes work with 30 sample contacts (Arabic, English, mixed); quick search finds "Moh" → "Mohammed", "احمد" → "أحمد" and a partial mobile in < 300 ms server time; every DB test above passes (`npm run test:db` green); an old session after a password change lands on the login page once, with no reload loop.

### Phase 2 — AI module (OpenRouter)
1. `ai/client.ts`, `json.ts`, `call-json.ts`, `tool-loop.ts`, `log.ts`.
2. `tests/mock-ai/server.mjs`.
3. Unit tests with mocked `fetch`:
   - `callJson`: valid output; fenced JSON accepted; invalid → retry → valid; invalid twice → `AI_FAILED`; `length` and `content_filter` not retried; image sent as a data URL to the vision model; `prompt` mode sends no `response_format`.
   - `client`: per-minute 429 retried then succeeds; daily 429 not retried → `TOO_MANY_REQUESTS`; 5xx retried; HTTP 200 with an `error` body fails; timeout; no raw error text in the `AppError` message; fallbacks sent as `models`.
   - `runToolLoop`: several tool calls in one turn; unparseable arguments and unknown tools answered as errors; early `final_answer`; prose final answer accepted; forced final round; nothing valid → `AI_FAILED`.
   - `json`: schema stripping and strict flags; loose parsing cases.
4. `scripts/ai-models.ts` and `scripts/ai-smoke.ts`.

**Done when:** unit tests pass; `npm run ai:models` lists free models per ability and says whether the configured ones qualify; `npm run ai:smoke` returns one validated contact from a real free model.

### Phase 3 — Model selection
1. From `ai:models`, shortlist up to 3 text models (tool calling; structured outputs preferred) and up to 3 vision models (image input).
2. For each, run a small eval (`--limit 3`) in `schema` mode; if the model rejects it, in `prompt` mode.
3. Pick `AI_MODEL_TEXT`, `AI_MODEL_VISION`, `AI_JSON_MODE` and up to 2 fallbacks. Write the table of candidates and results in Progress.

**Done when:** the chosen values are in `.env.example` comments and Progress, with the date and the numbers that justify them. If no free model handles images acceptably, report it before Phase 5.

### Phase 4 — Add from Text
1. `structure-text.ts` + prompt; `findDuplicates`.
2. Route `api/extract/text`; page with `ReviewTable` and **Save** (`source: "text"`); **Add manually**.
3. 10 text fixtures + expected JSON; `npm run eval:text`.

**Done when:** eval ≥ 95% on FullName, Company, Mobile, Email (below that: report numbers and misses and wait for a decision); re-submitting the same text flags duplicates; the same person twice in one text flags the in-batch duplicate; a daily-cap error shows the friendly message and the manual path still saves.

### Phase 5 — Add from Photo
1. `prepare-image.ts`, `extract-photo.ts` + prompt; `lib/shrink-image.ts`.
2. Route `api/extract/photo`; page: upload or take photo → preview → **Extract** → card count → review → **Save** (`source: "photo"`).
3. 10 photo fixtures (1, 4, 8, 12 cards; Arabic / English / bilingual; angled; uneven light) + expected JSON; `npm run eval:photo`.

**Done when:** card count correct on ≥ 9/10 photos and field accuracy ≥ 90%; an 8 MB iPhone HEIC extracts. **Expected weak spot:** 8- and 12-card photos. If they fail, report per card-count results and choose with the owner: accept and tell staff "up to N cards per photo" (show it on the page), another model, or the "detect → crop → extract per card" upgrade.

### Phase 6 — Explore
1. `search/tools.ts`, `search/ask.ts` + prompt; route `api/ask`.
2. `SearchBar`, `ContactTable` (server paging, sorting, filters), `Overview`, `ContactForm` (view / edit / delete), export button, vCard button.
3. 20 search questions + expected contact; `npm run eval:search`.

**Done when:** ≥ 90% of questions return the right contact in the top 3 within 3 rounds (below that: report and wait); quick search < 300 ms; table responsive at 12,000 contacts; Ask as department A never returns a contact of department B.

### Phase 7 — Import, admin pages, PWA, polish
1. `scripts/import-csv.ts` (`--department`, `--dry-run`), `seed.ts`, `migrate.ts`.
2. Admin pages (users, departments, activity), My account, Team.
3. PWA: manifest, icons, service worker that caches only the offline page.
4. Loading, empty and error states everywhere, including the three AI failure messages (busy, daily allowance used up, model not available).
5. `README.md`: setup from zero, OpenRouter key and privacy setting, choosing models, env, scripts, troubleshooting.

**Done when:** CSV import gives a clean report; all targets hold at 12,000 contacts; README runs the project from a fresh clone with only an OpenRouter key and a MongoDB URI; sign-in works with two accounts in different departments.

---

## 10. Future Upgrades

| Upgrade | How |
|---|---|
| Many cards per photo at higher accuracy | "Detect → crop → extract per card" inside `extract-photo.ts` (costs 1 request per card) |
| Paid model for better accuracy | `AI_ALLOW_PAID=true` + a paid model id. No code change |
| A model running on the machine (Ollama, LM Studio) | They speak the same chat completions format: point `OPENROUTER_BASE_URL` at them, or add a second client in `modules/ai/` |
| Different model per feature | Add `AI_MODEL_SEARCH`; `runToolLoop` reads it |
| Cache Ask answers for repeated questions | Small in-memory map in `search/ask.ts`, keyed by scope + question + day (saves free requests) |
| Telegram / WhatsApp bot | New `src/channels/<name>/` calling the same module functions |
| Microsoft sign-in | A second way to create the same session; users, departments and roles do not change |

---

## 11. Progress

| Phase | Status | Notes |
|---|---|---|
| 0 — Setup | Not started | |
| 1 — Accounts and data | Not started | |
| 2 — AI module (OpenRouter) | Not started | |
| 3 — Model selection | Not started | Record: date, candidates, JSON mode, eval numbers, chosen models |
| 4 — Add from Text | Not started | Live app with Claude, for comparison: key fields 100% |
| 5 — Add from Photo | Not started | Live app with Claude: counts 10/10, all fields 99.1% |
| 6 — Explore | Not started | Live app with Claude: Ask 20/20 top 3, quick search 12/12 |
| 7 — Import, admin, PWA, polish | Not started | |

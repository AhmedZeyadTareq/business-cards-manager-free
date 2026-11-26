# plan.md — Business Cards Manager (Next.js + OpenRouter free models + MongoDB Atlas)

This file is the complete specification and build plan. It is the source of truth.
Background and risks: `idea.md`. Env keys, commands, OpenRouter request formats, the search index and fixtures: `tools.md`. Accounts and running: `instructions.md`.

## 1. Approach
**Plain modules and functions. A free model is called through the OpenRouter API with `fetch`.**

- No agent framework and no AI SDK. Each feature is a module with simple exported functions.
- The model does the intelligence: structuring text, reading cards, understanding search questions.
- The code does the plumbing: UI, API routes, MongoDB, validation, and guarding against weak model output.
- Free models are small and not always available. Every AI reply is treated as untrusted text, and every feature either works or fails with a clear message when the AI is slow, wrong or out of free requests.

```
  Explore     ──┐                                ┌─ search/     ─┐─▶ ai/ (OpenRouter, fetch)
  Add: Text   ──┼─▶ proxy ─▶ API routes ─▶ modules ─ extraction/ ─┤
  Add: Photo  ──┘  (session)  (requireAccess)    └─ contacts/   ─┘─▶ db/ (MongoDB Atlas)
```

---

## 2. Pages

All pages except Login sit inside one layout with a sidebar.

### 2.1 Layout
- **Sidebar** (deep crimson `#870C30`, white text): logo and app name, links **Explore**, **Add from Text**, **Add from Photo**; for admins **Users**, **Departments**, **Activity**; footer with **Team**, **My account**, the signed-in person's name, department and role, and **Sign out**.
- On small screens: a top bar with the logo and a menu button that opens the sidebar as a native `<dialog>` (Esc closes, focus trapped).
- Links a role cannot use are hidden (viewers see no Add pages; only admins see admin links). The API enforces the same rules.
- A sidebar link asks before leaving a page with unsaved work.
- Theme: primary crimson `#AC103D`, grey `#808285`, white background; fonts IBM Plex Sans + IBM Plex Sans Arabic. Logo and icons are placeholders until the owner supplies them.
- UI labels are English only. Contact values may be Arabic: value cells and inputs use `dir="auto"`.
- Touch targets are at least 44 px. Lists never scroll sideways.
- One date format everywhere: `2 Nov 2026`, with time as `14:05` (24-hour, in the app time zone `APP_TIME_ZONE`, default `Asia/Baghdad`). The same zone decides what "today" and "this month" mean in the date filters, the overview, Ask AI and the per-user AI limit.
- A short toast confirms saves and deletes.

### 2.2 Login — `/login`
Username + password form, no sidebar. Wrong details: "Wrong username or password." On success, full reload to `/`.

### 2.3 Explore — `/`
From top to bottom:
1. **Search bar**: text box "Search contacts…" and an **Ask AI** button.
2. **Overview strip** (hidden while a search is showing): total contacts; added this month (and in the last 7 days); contacts per sector as six ranked bars with count and share. Clicking a bar filters the table by that sector; clicking again removes the filter.
3. **Filters**: Added by, City, Sector, date from, date to; plus Department for High Management. **Export CSV** button (hidden for viewers).
4. **Contact list**, 25 per page, with server-side paging and sorting. The layout follows the width of the list's own space:
   - under 52rem: one card per contact, with a **Sort by** select;
   - 52–68rem: table without City and Added (City shows under Company);
   - 68rem and up: full table — Name (with initials avatar), Position, Company, City, Mobile, Email, Sector, Added.
   - Every mobile and email shows on its own line. A stored `English / العربية` value shows on one line per language, English first (display only; the prompts store bilingual values Arabic first, and both orders are handled). High Management sees the department name under the sector. Phones and emails are plain text, not links.
5. Clicking a row opens the **contact dialog**: the 8 fields, **Save changes**, **Reset**, **Delete** (asks "Delete this contact?"), **Add to phone contacts** (downloads a `.vcf`), added and updated date and time. Viewers get it read-only ("View only"). Closing with unsaved edits asks first. On short screens the header and buttons stay in view and the fields scroll.

**Search behaviour**
- Typing 2+ characters runs **quick search** after a 150 ms pause. The list shows the matches, "Showing 20 of 65 results", and **Show more** (20 more each time, up to 1,000).
- **Enter**: opens the first match. If Enter is pressed before the search returns, it acts when the result arrives. With no matches the list says "No matches. Try Ask AI." and nothing is sent: only the **Ask AI** button spends AI requests.
- **Ask AI** button: always asks the AI. The answer shows in a box above the matching contacts. Empty result: "The AI found no matching contacts."
- A search covers all contacts in the person's scope and ignores the table filters. If filters are set, a notice names them, says they do not apply, and offers **Back to filtered table**.
- **Export follows the screen:** table → "Export CSV" or "Export CSV (filtered)" (all matching contacts, not only the page); quick search → "Export N results" (every match, even beyond 1,000); Ask AI → "Export N results" (only the listed contacts). Disabled at 0 results.

### 2.4 Add from Text — `/add/text`
Textarea + **Structure with AI** ("Structuring…" while loading) + **Add manually**. Short tips beside it. The result appears in the **review list** (§2.6), and the page scrolls to it.

### 2.5 Add from Photo — `/add/photo`
- **Choose photo** (JPG, PNG, WEBP, HEIC) and, on touch devices, **Take photo** (camera). A preview shows when the browser can display the file.
- Photos over 4 MB are shrunk in the browser first (long edge 2000 px, JPEG quality 0.9 → 0.8 → 0.65) to fit a host's upload limit. If the browser cannot read the file (HEIC outside Safari), the original is sent. If the host rejects the upload (HTTP 413), the page says "This photo is too large to upload. Export it as JPG and try again."
- **Extract contacts** ("Reading cards…", with the note "Many cards can take up to a minute."). Then: "N cards found", a warning if the AI counted a different number than it read, and the review list. **Add manually** is also here.
- Choosing a new photo or extracting again asks first if contacts are still under review.

### 2.6 Review list (shared by both Add pages)
- One block per contact with all 8 fields editable (Sector is a select). A contact can be removed.
- **Duplicate** (same mobile or email already saved in this department, or earlier in this batch): a badge "Already saved: name" or "Same as contact N above" with **Skip / Save anyway**. Duplicates start on Skip.
- An invalid email shows in red and blocks the save. A number that could not be formatted shows an amber "check this number" hint and does not block.
- A **Save N contacts** bar stays in view. After saving: "Saved N contacts."
- Leaving the page, reloading or starting a new run with unsaved contacts asks first. (The browser Back button cannot be guarded.)
- **Add manually** opens the same list with one empty block; it saves with `source: "manual"` and uses no AI.

### 2.7 Other pages
- **Team** — `/team`: static cards with the people behind the app (names and roles from the owner). No API calls.
- **My account** — `/account`: username, department, role with a one-line explanation, and a change-password form (current, new, new again).
- **Users** — `/admin/users`: add a user (username, full name, first password, department, role); per user: change name, department, role, reset password, activate / deactivate. Admin is offered only for High Management.
- **Departments** — `/admin/departments`: add, rename, activate / deactivate. High Management cannot be deactivated.
- **Activity** — `/admin/activity`: who added, edited, deleted or exported, newest first, 50 per page.

### 2.8 When the AI is unavailable
The AI routes return a user-safe message, which the page shows as is:

| Situation | Message |
|---|---|
| Too many requests right now | AI service is busy. Try again in a minute. |
| Daily free allowance used up | Today's free AI allowance is used up. Quick search and manual add still work. |
| Model removed or blocked by settings | The AI model is not available. Tell an administrator. |
| The person's own daily AI limit is reached | You have used your AI allowance for today. Quick search and manual add still work. |
| The action's deadline passed | AI service timed out. Try again. |

Quick search, the table, edit, delete, export and manual add never call the AI.

---

## 3. Fixed Decisions

| Area | Decision |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Hosting | **Vercel** (production). A local run bound to `127.0.0.1` (`npm run dev`, or `npm run build && npm start`) is only for testing before a deploy; nobody else can reach it |
| Next.js config | `cacheComponents`, `partialPrefetching`, `experimental.proxyClientMaxBodySize: "25mb"` (with `proxy.ts` active, larger bodies are cut off; `MAX_IMAGE_MB` cannot be set above 20, so an allowed photo always fits); headers on every response: `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; `Cache-Control: no-cache` for `/sw.js` |
| Access | Per-user username + password (scrypt from Node `crypto`, no auth library), signed session cookie keyed by `AUTH_SECRET`. One database: each contact has a server-set `DepartmentId`; every contacts read takes a required scope |
| Code style | Modules + plain exported functions. No classes, no agent framework |
| UI | Tailwind 4 + shadcn/ui, `lucide-react` icons |
| AI provider | **OpenRouter** chat completions API (`POST /api/v1/chat/completions`, OpenAI-compatible JSON), called with built-in `fetch` from `modules/ai/client.ts`. No SDK |
| Models | Env only: `AI_MODEL_TEXT` (text + Ask AI; must support tool calling) and `AI_MODEL_VISION` (photos; must accept images). Default `openrouter/free` (OpenRouter picks a free model). Pin specific `:free` models once the evals have chosen them. Optional fallbacks per feature: `AI_FALLBACK_MODELS_TEXT` (each must support tool calling) and `AI_FALLBACK_MODELS_VISION` (each must accept images) |
| Free only | `config.ts` rejects a model id that is not `openrouter/free` and does not end in `:free`, unless `AI_ALLOW_PAID=true` |
| Structured output | `AI_JSON_MODE=schema`: `response_format: { type: "json_schema", strict: true }` from the Zod schema + `provider.require_parameters` + the `response-healing` plugin. `AI_JSON_MODE=prompt`: the schema is written into the prompt. Both: tolerant JSON parsing, then Zod, then one corrective retry |
| Output size | `AI_MAX_TOKENS` (default 8000) is the `max_tokens` of every request unless the caller asks for less; many free models reject larger values |
| Retries | `client.ts`: timeout `AI_TIMEOUT_MS` (default 60 s); up to 2 retries on per-minute 429, 408, 5xx and network errors (honours `Retry-After`); never retries the daily-cap 429 |
| Deadline | Every request, retry and round of one user action shares one deadline, `AI_DEADLINE_MS` (default 120 s). A request never gets more time than is left, and no retry or round starts after it. The three AI routes set their function duration (`maxDuration = 300`, a build-time constant) above the largest allowed deadline (`AI_DEADLINE_MS` ≤ 280 s), so Vercel never cuts a request off without a message |
| Per-user AI limit | `AI_USER_DAILY_LIMIT` (default 15, `0` = off) AI actions per person per day; one extraction or one question = 1. Counted in `ai_usage`, so one person cannot use up the shared free allowance |
| Time zone | `APP_TIME_ZONE` (default `Asia/Baghdad`): displayed times, the day boundaries of date filters, "today" in Ask AI, and the per-user AI day |
| Privacy | Test data only until the owner decides. `AI_DATA_COLLECTION` (`allow` / `deny`) is sent as `provider.data_collection`. Prompt and response bodies are never logged |
| Database | MongoDB Atlas free tier (M0), database `cards`. Atlas Local (Docker) for tests. Plain MongoDB Community cannot be used: search needs Atlas Search |
| Driver | Official `mongodb` driver, no ORM. One cached `MongoClient` on `globalThis` (safe for dev hot reload) |
| Search | Atlas Search index `contacts_search` (`tools.md` §9) + normal filters |
| Images | Server: real type detected from the file's first bytes (the browser's type is not trusted); HEIC → JPEG with `heic-convert`; then `sharp`: auto-rotate from EXIF, resize, JPEG. Steps down (2000 px q85 → 2000 q72 → 1600 q72 → 1280 q65) until the base64 is under `MAX_AI_IMAGE_BYTES` (constant in `prepare-image.ts`, 5 MB; lower it if a model rejects large images). Sent as a base64 data URL |
| Prompts | Versioned TypeScript files exporting `{ id, text }` (`*.vN.ts`), bundled by Next.js, no runtime file reads |
| Validation | Zod v4: one contact schema for AI output, API input and DB writes; `z.toJSONSchema()` for output and tool schemas |
| Writes | The AI never writes to the DB. Saving happens only via `POST /api/contacts` after user review |
| Errors | `AppError` with a code and a user-safe message. Unknown errors are logged and answered with "Something went wrong" |
| Quality | ESLint + Prettier + `tsc --noEmit` + Vitest: `npm run check`. GitHub Actions runs it, and `npm run test:db` against an Atlas Local service container, on every push and pull request |
| Version control | Git; one commit per approved phase |

---

## 4. Folder Structure

```
.env.example                         → all env keys, no values
CLAUDE.md                            → agent instructions
docs/                                → plan.md, idea.md, instructions.md, tools.md
next.config.ts, vercel.json          → vercel.json only sets the region next to the database

src/
  instrumentation.ts                 → validates env at server startup (imports lib/config)
  proxy.ts                           → session cookie genuine and unexpired? else /login (pages) or 401 (API)
  app/
    layout.tsx, globals.css, manifest.ts, icon.png, apple-icon.png
    login/page.tsx
    (app)/layout.tsx                 → sidebar; loads /api/me
    (app)/page.tsx                   → Explore
    (app)/add/text/page.tsx, (app)/add/photo/page.tsx
    (app)/team/page.tsx, (app)/account/page.tsx
    (app)/admin/users/page.tsx, admin/departments/page.tsx, admin/activity/page.tsx
    api/                             → see §7

  modules/
    ai/                              → THE ONLY CODE THAT CALLS OPENROUTER
      client.ts                      → chat(body, deadline): fetch, auth, fallbacks, timeout, deadline, retries, error mapping
      call-json.ts                   → callJson({ prompt, input, schema, image?, maxTokens? })
      tool-loop.ts                   → runToolLoop(): bounded tool loop used by search/ask
      json.ts                        → toProviderSchema(schema, { strict }), parseJsonLoose(text)
      log.ts                         → one line per call: prompt id, model, latency, tokens, attempt

    accounts/
      account.schema.ts              → ROLES, permissionsFor(role), user / department inputs (Zod), Me
      access.ts                      → requireAccess(permission?), accessFor(user, department), describeMe
      scope.ts                       → Scope, Actor, Writer, scriptWriter
      users.repo.ts                  → listUsers, createUser, updateUser, findUserByUsername, setPasswordHash
      departments.repo.ts            → listDepartments, createDepartment, updateDepartment, ensureHighManagement
      login.ts                       → signIn (with lockout), changePassword
      login-attempts.ts              → failed sign-ins per username + network address
      ai-usage.ts                    → spendAiUse(userId): the per-user daily AI limit
      password.ts, session.ts        → scrypt hashes · signed session tokens (no DB, used by proxy.ts)

    audit/audit.repo.ts              → writeAudit, listAudit

    contacts/
      contact.schema.ts              → FIELDS, SECTORS, SOURCES, ContactInput, Contact — single source of truth
      contacts.repo.ts               → listContacts, listAllContacts, quickSearch, searchContacts, getContact,
                                       getContactsByIds, insertContacts, updateContact, deleteContact,
                                       listValues, listCreators, findDuplicates, deleteAllContacts
      normalize.ts                   → normalizeMobile, unusualMobiles, normalizeEmail, invalidEmails,
                                       normalizeDigits, normalizeText, foldArabic, normalizeSector,
                                       cleanContact, cleanForReview, toMatchKeys
      export.ts                      → ExportQuery, toCsv, exportForAccess
      vcard.ts                       → toVcard, vcardFilename, contactVcard
      import.ts                      → decodeCsv, parseCsv, mapColumns, rowToContact

    extraction/
      structure-text.ts              → structureText(departmentId, text)
      extract-photo.ts               → extractPhoto(departmentId, file)
      prepare-image.ts               → prepareImage(buffer) → base64 JPEG
      prompts/                       → structure-text.v1.ts, extract-photo.v1.ts, extract-photo.v2.ts (in use), sector-rules.v1.ts

    search/
      ask.ts                         → ask(scope, question)
      tools.ts                       → tool definitions + handlers
      prompts/search.v1.ts

    db/                              → mongo.ts (getDb, collections, withDb), setup.ts, search-index.json
    shared/                          → errors.ts (AppError), api-response.ts (ok / fail / file / readJson), request.ts (queryOf)

  components/                        → AppSidebar, SearchBar, Overview, ExploreFilters, ContactTable, ContactForm,
                                       ContactFields, ReviewTable, Toast, MeProvider, PageHeader, ServiceWorker, ui/*
  lib/
    config.ts                        → env (Zod), fails fast
    api.ts                           → browser fetch helper for the API routes
    use-api.ts                       → React hook: load an API path, reload, keep the last data
    dates.ts                         → days and date formats in the app time zone (server + pages)
    utils.ts                         → cn() class-name helper
    bilingual.ts                     → splits "English / العربية" for display (either order stored, English line first); avatar initials
    shrink-image.ts                  → shrinks large photos in the browser before upload
    unsaved.ts                       → asks before leaving with unsaved work

public/                              → sw.js, offline.html, icons/

scripts/
  ai-models.ts, ai-smoke.ts
  eval-text.ts, eval-photo.ts, eval-search.ts, eval-score.ts, eval-common.ts
  make-icons.ts                      → renders the placeholder app icons
  make-photo-fixtures.ts             → renders the synthetic card photos + expected JSON
  db-setup.ts, seed.ts, import-csv.ts, users-add-admin.ts

tests/
  mock-ai/server.mjs                 → fake chat completions API (OPENROUTER_BASE_URL)
  unit/                              → mocked fetch; no network, no database
  db/                                → integration tests (`npm run test:db`, not part of `check`)
  fixtures/                          → sample-contacts.json, text/, photos/, search/questions.json, import/, fonts/
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

## 5. Data

### 5.1 Contact document

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

- The 8 business fields (`FIELDS`, in this display order) are strings: max 300 characters, `Notes` max 2,000. Empty when unknown — **never invented**.
- `Sector` is never empty: exactly one of `SECTORS`:
  `Ministries & Government`, `Businesses & Financial Institutions`, `Embassies & International Organizations`, `Universities & Education`, `NGOs & Civil Society`, `Professional & Other Contacts`. Missing or unclear → the last one (`DEFAULT_SECTOR`).
- `Mobile` and `Email` may hold several values, separated by ` | ` (`MULTI_SEPARATOR`; a pipe, so CSV cells never contain commas). `splitMulti` splits on `|` or `,`.
- Office, landline and fax numbers go to `Notes`, labelled (`Office: +964 1 …; Website: …`).
- `SOURCES` = `text`, `photo`, `manual`, `import`. The client sends it; the server validates it.
- `DepartmentId`, `CreatedBy`, `UpdatedBy`, `CreatedAt`, `UpdatedAt`, `_mobiles`, `_emails` are set by the server only. `CreatedBy` / `UpdatedBy` are `null` for scripts.
- `_mobiles` / `_emails` are derived on every insert and update, used for duplicate checks and exact lookups, never shown.

**Zod schemas in `contact.schema.ts`**
- `ContactInput`: all 8 fields required (unknown = `""`). This is what the AI returns and what gets stored.
- `ContactInputLoose`: missing fields default to `""` (Sector → `DEFAULT_SECTOR`). Used by `POST /api/contacts`.
- `ContactPatch`: any subset of the 8 fields. Used by `PATCH`.
- `SaveContactsBody`: `{ source, contacts: ContactInputLoose[] }`, 1–200 contacts.
- `Contact` (API output): the 8 fields + `id`, `DepartmentId`, `Source`, `CreatedAt`, `UpdatedAt` (ISO strings).
- `ReviewContact`: `ContactInput` + optional `duplicateOfId`, `duplicateOfName`, `duplicateInBatch`.

### 5.2 Cleaning rules (`normalize.ts`)

`cleanContact` runs on every insert and update. It never adds data.

**Text fields** (`normalizeText`): remove invisible direction marks (U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF), collapse whitespace, trim. Letters stay as written. `Notes`: only invisible marks removed and trimmed.

**Digits** (`normalizeDigits`): Arabic-Indic `٠-٩` and Persian `۰-۹` → `0-9`.

**Comparing and searching only** (`foldArabic`): normalized text with harakat and tatweel removed, `أ إ آ ٱ` → `ا`, `ة` → `ه`, `ى` → `ي`, the Persian / Kurdish letter forms `ی` (U+06CC) → Arabic yeh and `ک` (U+06A9) → Arabic kaf, lowercase. Never stored. The search index mapping (`tools.md` §9) must fold the same letters.

**Mobile** (`normalizeMobile`)
1. Convert digits, remove invisible marks.
2. Split into numbers on `,` `;` `؛` `|` newline `/` `،` and the words ` or `, ` و `, ` أو `.
3. A piece with more than 15 digits is split further on spaces and hyphens: a number ends when it is a complete Iraqi mobile or the next part starts with `+` or `00`. If any resulting piece is not a plausible number (only `+ digits space - ( ) .`, 6–15 digits not counting a leading `00`), the whole piece is kept untouched.
4. Each number:
   - no digits → dropped;
   - remove a printed trunk zero `(0)` and any label before the first digit or `+` (such as `M:`);
   - not a plausible number → **kept as written**;
   - Iraqi mobile → `+9647XXXXXXXXX`. Pattern on the digits: optional `00964`, `964`, `9640` or `0`, then `7` and 9 more digits;
   - starts with `+` or `00` → `+` and the digits, with the `00` removed and `9640` → `964`. If the result starts with `9647` but is not a valid Iraqi mobile, keep it as written;
   - digits are `964` + 9 or 10 digits → `+` and the digits;
   - looks Iraqi (starts with `07`, `7` or `964`) but has the wrong length → kept as written;
   - anything else → the digits only.
5. Deduplicate; join with ` | `.

A number is never merged with another, trimmed, or given a guessed country code. `unusualMobiles(value)` returns the numbers that do not match `^\+\d{7,15}$`; the UI shows the "check this number" hint for them. A foreign number written without `+` or `00` that fits the Iraqi pattern is read as Iraqi; the two cannot be told apart.

**Email**
- Tokens: normalized text, lowercase, `mailto:` removed, split on whitespace `,` `;` `؛` `،` `|` `/`, with surrounding `< ( " '` and trailing `> ) " ' .` stripped, deduplicated.
- Valid = `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
- `normalizeEmail` keeps valid tokens, joined with ` | `. `invalidEmails` returns the others.
- **Saving is refused while there is an invalid email** (`VALIDATION`: "Not a valid email: x. Fix it or clear the field."), checked before cleaning in both `insertContacts` and `updateContact`.
- `cleanForReview` = `cleanContact` but keeps every email token, valid or not, so the review list can show the invalid ones in red.

**Sector** (`normalizeSector`): exact match, then case-insensitive match, then short names (`ministry`, `ministries`, `government` → Ministries & Government; `business`, `businesses`, `company`, `bank`, `banking` → Businesses & Financial Institutions; `embassy`, `embassies`, `international organization` → Embassies & International Organizations; `university`, `universities`, `education` → Universities & Education; `ngo`, `ngos`, `civil society` → NGOs & Civil Society; `professional`, `other` → Professional & Other Contacts); otherwise `DEFAULT_SECTOR`. `matchSector` is the same but returns `undefined` when unknown.

**Match keys** (`toMatchKeys`, input already cleaned): `_mobiles` = each mobile with everything except digits and `+` removed, kept only if it has at least 6 digits; `_emails` = each email.

### 5.3 Other collections

| Collection | Document |
|---|---|
| `departments` | `{ _id, name, isHighManagement, active, createdAt }`. Exactly one has `isHighManagement: true`, named "High Management" |
| `users` | `{ _id, username, name, passwordHash, departmentId, role, active, sessionVersion, createdAt, updatedAt }` |
| `login_attempts` | `{ _id: "username\|address", username, count, expiresAt }` |
| `ai_usage` | `{ _id: "userId\|YYYY-MM-DD", count, expiresAt }` (the day in the app time zone) |
| `audit_log` | `{ _id, at, userId, username, action, contactId?, contactName?, departmentId?, before?, count?, detail? }`; `action` = `create`, `update`, `delete`, `export` |

### 5.4 Indexes (`db/setup.ts`, safe to re-run)
- `contacts`: `City`, `Sector`, `Company`, `CreatedAt: -1`, `{ DepartmentId: 1, CreatedAt: -1 }`, `_emails`, `_mobiles`.
- `departments`: unique `name` with collation `{ locale: "en", strength: 2 }` (case-insensitive).
- `users`: unique `username`. `audit_log`: `at: -1`. `login_attempts` and `ai_usage`: TTL on `expiresAt` (`expireAfterSeconds: 0`).
- Atlas Search index `contacts_search` on `contacts` (definition in `tools.md` §9): create it, or update it if it exists, then wait until it is `READY` and queryable (poll every 2 s, up to 4 minutes).

---

## 6. Accounts and access

### 6.1 Roles

| Role | Search + view | Add + edit | Delete | Export CSV | Manage departments + users |
|---|:-:|:-:|:-:|:-:|:-:|
| **Viewer** | Own scope | — | — | — | — |
| **Editor** | Own scope | Add to own department, edit in own scope | Own scope | Own scope | — |
| **Admin** (High Management only) | Everything | Add to own department, edit everything | Everything | Everything | Yes |

"Own scope" = the person's department, or every department for High Management.
`permissionsFor(role)` → `{ add, edit, delete, export, admin }`: the first four are true for editor and admin; `admin` only for admin.

### 6.2 Types (`scope.ts`, `access.ts`)
```ts
type Scope  = { kind: "all" } | { kind: "department"; departmentId: ObjectId };
type Actor  = { userId: ObjectId | null; username: string };
type Writer = { scope: Scope; departmentId: ObjectId; actor: Actor };
type Access = Writer & { user: User; department: { id, name, isHighManagement }; can: Permissions };
```
- `requireAccess(need?)` is called first in every API route. It reads the session cookie, loads the user and department **from the database on every request**, and throws `UNAUTHORIZED` ("Please sign in.") or `FORBIDDEN` ("Only administrators can do this." / "Your role can only view contacts. Ask an administrator to change it.").
- `requireAccess(need, { ai: true })` is used by the three AI routes. After the access checks it calls `spendAiUse`: it adds 1 to the person's count for today and throws `TOO_MANY_REQUESTS` ("You have used your AI allowance for today. Quick search and manual add still work.") once the count is above `AI_USER_DAILY_LIMIT`. The use is counted even if the AI call then fails. Scripts and evals are not limited.
- `scriptWriter(departmentId, name)` is the `Writer` for scripts: actor `{ userId: null, username: "script:<name>" }`.

### 6.3 Passwords and sessions
- **Username**: 3–32 characters, `a-z 0-9 . _ -`, stored lowercase. **Password**: 8–200 characters.
- **Hash**: scrypt (`N=16384, r=8, p=1`, 16-byte salt, 64-byte key), stored as `scrypt$N$r$p$salt$hash` (base64url). Compare with `timingSafeEqual`. For an unknown username, verify against a fixed dummy hash so the answer takes the same time.
- **Session token**: `userId.sessionVersion.expiry.signature`, signature = HMAC-SHA256 of `session:<payload>` with `AUTH_SECRET`, base64url. Valid 30 days.
- **Cookie** `cards_session`: `httpOnly`, `sameSite: lax`, `path: /`, `secure` when the request is HTTPS, `maxAge` 30 days.
- **`proxy.ts`** runs on every page and API route except static assets and the PWA files (`_next/static`, `_next/image`, `favicon.ico`, `icon.png`, `apple-icon.png`, `manifest.webmanifest`, `sw.js`, `offline.html`, `icons/`). It checks only the token's signature and expiry (no database): valid token on `/login` → redirect to `/`; no valid token → pages redirect to `/login`, API routes answer 401; `/api/auth/login` always passes.
- A session is refused by `requireAccess` when the user or their department is inactive or missing, or `sessionVersion` differs from the token's. `sessionVersion` increases on a password change, an admin reset and a deactivation.
- **When `requireAccess` refuses a session, it deletes the cookie.** A role refusal (`FORBIDDEN`) keeps it. On any 401, the browser helper (`lib/api.ts`) calls `/api/auth/logout`, then goes to `/login`, and shows no error meanwhile. Without both, an old but validly signed cookie bounces between `/login` and the app in a loop.
- Changing your own password returns a fresh cookie for this browser and signs out every other device.

### 6.4 Sign-in rules (`login.ts`, `login-attempts.ts`)
- Unknown username and wrong password get the same answer: "Wrong username or password." An inactive account or department: "This account is not active. Ask an administrator for access."
- 5 wrong passwords for one username **from one network address** lock that address out of that username for 15 minutes (`TOO_MANY_REQUESTS`: "Too many wrong tries. Wait 15 minutes, or ask an administrator to reset your password."). The real person, on another address, can still sign in.
- Address = `x-real-ip`, else the first `x-forwarded-for` entry, else `"local"`. Vercel sets these headers itself, so they can be trusted there. Behind any other proxy, the proxy must overwrite them, or the lockout can be bypassed.
- A successful sign-in clears that address's count. An admin password reset clears every lock on the username.

### 6.5 Admin rules
- Admins must be in High Management ("Admins must be in High Management."). A user can only be placed in an active department.
- Nobody can remove their own admin access or deactivate themselves; at least one active admin always stays.
- Users and departments are deactivated, never deleted, so the activity log stays readable.
- High Management cannot be deactivated. People in an inactive department cannot sign in; its contacts are kept.
- `ensureHighManagement()` creates the High Management department on first use.

### 6.6 The access rule
- Every read function in `contacts.repo.ts` takes the scope as a **required** argument, so a call without one fails typecheck.
- The scope condition is always combined with the caller's filter using `$and`, so a `DepartmentId` filter can only narrow a department user's scope, never widen it.
- New contacts go to the signed-in user's department, read on the server. Editing does not move a contact.
- A contact outside the user's scope returns `NOT_FOUND`, not "forbidden", so its existence is not revealed.
- A contact with no `DepartmentId` is visible only to High Management.
- `DepartmentId`, `CreatedBy` and `UpdatedBy` in a request body are dropped by the schema.

Every place contacts can come out must apply the scope:

| Place | Function | Risk if missed |
|---|---|---|
| Table and overview figures | `listContacts` | Hidden contacts and totals |
| Quick search: phone, email and text branches, and the total count | `quickSearch` (`$search` and `$searchMeta` both) | Hidden contacts, or a count that reveals them |
| Ask AI | `searchContacts`, `listValues`, `getContactsByIds` | Hidden contacts in AI answers |
| CSV export | `listAllContacts`, `quickSearch`, `getContactsByIds` | Hidden contacts in the file |
| Filter lists and sector bars | `listValues`, `listCreators` | Company and city names, or who added contacts, revealed |
| Opening by id, vCard, edit, delete | `getContact`, `updateContact`, `deleteContact` | Access by direct link |
| Duplicate warning | `findDuplicates` (own department only) | "Already saved: name" reveals a hidden person |

Ask AI: the scope is fixed in the tool handlers on the server. It is never a tool input, so neither the model nor a question can widen it.

### 6.7 Activity log
`insertContacts`, `updateContact` and `deleteContact` write one `audit_log` entry per contact (`contactName` = FullName or Company; update and delete store the previous document in `before`, without the match keys). Each export writes one entry with `count` and `detail` ("AI search results", "Search: <q>", "Table: all" or "Table: City=Baghdad, …"). The list endpoint never returns `before`.

---

## 7. API

Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message, details? } }`.

| Code | Status | | Code | Status |
|---|---|---|---|---|
| `VALIDATION` | 400 | | `UNSUPPORTED_MEDIA` | 415 |
| `UNAUTHORIZED` | 401 | | `TOO_MANY_REQUESTS` | 429 |
| `FORBIDDEN` | 403 | | `INTERNAL` | 500 |
| `NOT_FOUND` | 404 | | `AI_FAILED` | 502 |
| `CONFLICT` | 409 | | `DB_FAILED` | 503 |
| `PAYLOAD_TOO_LARGE` | 413 | | | |

`fail(error)`: `AppError` → its code and message; `ZodError` → `VALIDATION` "Invalid input" with the issues in `details`; anything else → logged, `INTERNAL` "Something went wrong". Malformed JSON bodies → `VALIDATION`. Database driver errors → `DB_FAILED` "Database is not reachable. Try again in a moment."

Every API response, including the CSV and vCard files, sends `Cache-Control: no-store`, so no contact data stays in a browser cache.

| Route | Needs | Input | Returns |
|---|---|---|---|
| `POST /api/auth/login` | — | `{ username, password }` | sets the cookie; `{ signedIn: true }` |
| `POST /api/auth/logout` | — | — | clears the cookie |
| `GET /api/me` | signed in | — | `{ user, department, can, timeZone, departments? }` (`departments` for High Management; `timeZone` = `APP_TIME_ZONE`, used by the pages to show dates) |
| `POST /api/me/password` | signed in | `{ currentPassword, newPassword }` | new cookie; `{ changed: true }` |
| `GET /api/search` | signed in | `?q=` (max 200) `&limit=` (1–1000, default 20) | `{ items, total }` |
| `POST /api/ask` | signed in + 1 AI use | `{ question }` | `{ answer, contacts, rounds }` |
| `POST /api/extract/text` | `add` + 1 AI use | `{ text }` | `{ contacts: ReviewContact[] }` |
| `POST /api/extract/photo` | `add` + 1 AI use | multipart, field `image` | `{ cardCount, contacts, warning? }` |
| `GET /api/contacts` | signed in | `page`, `pageSize` (≤100, default 25), `sort` (a field, `CreatedAt` or `UpdatedAt`), `dir`, `Company`, `City`, `Sector`, `DepartmentId`, `CreatedBy`, `dateFrom`, `dateTo` | `{ items, total }` |
| `POST /api/contacts` | `add` | `{ source, contacts[] }` | saved contacts, status 201 |
| `GET /api/contacts/:id` | signed in | — | contact |
| `PATCH /api/contacts/:id` | `edit` | any of the 8 fields | contact |
| `DELETE /api/contacts/:id` | `delete` | — | `{ deleted: id }` |
| `GET /api/contacts/:id/vcard` | signed in | — | `text/vcard` file, `Content-Disposition: inline`, `Cache-Control: no-store` |
| `GET /api/contacts/export` | `export` | `ids` (comma-separated) or `q`, otherwise the table filters | CSV file `contacts-YYYY-MM-DD.csv` |
| `GET /api/contacts/values` | signed in | `?field=Company\|City\|Sector` | `[{ value, count }]` |
| `GET /api/contacts/creators` | signed in | — | `[{ id, name, username, count }]` |
| `GET, POST /api/admin/users` | `admin` | POST `{ username, name, password, departmentId, role }` | users (never the hash) |
| `PATCH /api/admin/users/:id` | `admin` | `{ name?, departmentId?, role?, active?, password? }` | user |
| `GET, POST /api/admin/departments` | `admin` | POST `{ name }` | departments |
| `PATCH /api/admin/departments/:id` | `admin` | `{ name?, active? }` | department |
| `GET /api/admin/activity` | `admin` | `page`, `pageSize` (≤100, default 50) | `{ items, total }` |

GET routes that read request data call `await connection()` from `next/server` first, so they run at request time.

The three AI routes (`ask`, `extract/text`, `extract/photo`) export `maxDuration = 300`. Next.js reads `maxDuration` at build time, so it cannot be computed from an env value; instead `config.ts` refuses an `AI_DEADLINE_MS` above 280 s, which keeps every allowed deadline at least 20 s inside the function duration. If the Vercel plan allows less than 300 s, lower `maxDuration` in the three routes and keep `AI_DEADLINE_MS` at least 20 s below it.

---

## 8. Module Functions

### 8.1 `ai/client.ts` — `chat(body, deadline)`
1. Build the request: `model`, plus `models` when fallbacks are set for this kind of request (the same model first, then `AI_FALLBACK_MODELS_VISION` if a message has an image, else `AI_FALLBACK_MODELS_TEXT`), `provider { require_parameters, data_collection }`, the caller's `messages`, `tools`, `response_format`, and `max_tokens` = `AI_MAX_TOKENS`, or the caller's value when it is lower.
2. `fetch` with a timeout of `AI_TIMEOUT_MS` or the time left before `deadline`, whichever is smaller. `callJson` and `runToolLoop` each create one deadline (`AI_DEADLINE_MS` after they start) and pass it to every `chat()` call they make. Once it has passed, nothing new starts: `AI_FAILED` "AI service timed out. Try again."
3. Retry up to 2 times on per-minute 429, 408, 5xx and network errors. Wait `Retry-After` if present, else 2 s then 5 s. If the wait would end after the deadline, do not retry.
4. A body containing `error` is a failure even with HTTP 200.
5. Map failures to `AppError` with a safe message (`tools.md` §7.6): `TOO_MANY_REQUESTS` for 429, otherwise `AI_FAILED`. Log the raw error on the server only.
6. Return `{ message, finishReason, model, usage }`.

### 8.2 `ai/call-json.ts` — `callJson({ prompt, input, schema, image?, maxTokens? })`
1. Model: `AI_MODEL_VISION` if `image`, else `AI_MODEL_TEXT`.
2. Messages: system = prompt text (+ the schema instruction in `prompt` mode); user = the text, plus an `image_url` data URL part when there is an image.
3. `schema` mode: `response_format` from `toProviderSchema(schema, { strict: true })`, plus the `response-healing` plugin.
4. `chat()`. `finish_reason: "length"` with some content → `AI_FAILED` "Input is too large for one request. Try fewer items at a time." `length` with **empty** content (a reasoning model spent every token thinking) → `AI_FAILED` "The AI ran out of room before answering. Tell an administrator." `content_filter` → `AI_FAILED` "The AI declined to process this input." Neither is retried.
5. `parseJsonLoose(content)` → Zod.
6. On invalid JSON or a Zod failure: retry **once** — append the assistant turn and a user message listing the problems ("Your previous output failed validation: … Return the complete corrected JSON."). Still invalid → `AI_FAILED` "The AI returned data in an unexpected format. Please try again."
7. Log each call.

### 8.3 `ai/tool-loop.ts` — `runToolLoop({ prompt, userText, tools, final, maxRounds = 3 })`
Round = one `chat()` call.
1. Rounds 1 … max−1: `tool_choice: "auto"` with the tools + the final tool. Run **every** tool call of the turn; answer each with a `role: "tool"` message. Arguments arrive as a JSON string: parse, then validate with the tool's Zod schema. A bad or unknown call gets an error sentence as its result; a handler that throws gets "The search failed. Try different parameters."
2. A valid final-tool call ends the loop, even next to other calls.
3. A turn with no tool calls: if its text parses as a valid final answer, accept it; otherwise add the user message "Finish by calling final_answer."
4. Last round: `tool_choice: "none"`, ask for the final answer as JSON (`response_format` in `schema` mode), parse loosely, validate. A final-tool call is also accepted.
5. Nothing valid → `AI_FAILED` "AI search did not finish. Try rephrasing the question."
6. Returns `{ result, rounds, calls }`.

### 8.4 `ai/json.ts`
- `toProviderSchema(zodSchema, { strict })`: `z.toJSONSchema()` → remove `$schema`, `maxLength`, `minimum`, `maximum`, `format`, `pattern`. Zod re-checks what was removed.
  - `strict: true` — **only for `response_format`**: also set `additionalProperties: false` and every property `required` on every object.
  - `strict: false` — **for tool `parameters`**: optional fields stay optional. Never make the search tool's fields required: the model would fill every field and searches would match nothing.
- `parseJsonLoose(text)`: trim, drop ``` fences, take the first `{` to the last `}`, `JSON.parse`. Throws on failure.

### 8.5 `extraction/`
- `structureText(departmentId, text)`: empty → `VALIDATION` "Paste some text first."; longer than `MAX_TEXT_CHARS` → `PAYLOAD_TOO_LARGE`; `callJson` with the structure-text prompt, input `<text>\n…\n</text>`, schema `{ contacts: ContactInput[] }`; `cleanForReview` each; drop contacts whose 8 fields are all empty; `findDuplicates`; return `{ contacts }`.
- `extractPhoto(departmentId, file)`: empty file → `VALIDATION`; larger than `MAX_IMAGE_MB` → `PAYLOAD_TOO_LARGE`; `prepareImage` (unknown type → `UNSUPPORTED_MEDIA` "Unsupported image. Use JPG, PNG, WEBP or HEIC."); `callJson` with the image, input "Extract every business card in this photo.", schema `{ cardCount: int 0–50, contacts: ContactInput[] }`; if `cardCount !== contacts.length` add `warning` "The AI counted N cards but read M. Check the photo for missed cards."; `cleanForReview` each; `findDuplicates`; return `{ cardCount, contacts, warning? }`.
- Both keep the AI step as a separate exported function without the database (`extractContactsFromText`, `extractContactsFromPhoto`) so the evals can call it.

### 8.6 `contacts.repo.ts`
- `listContacts(scope, query)`: exact-match filters on `Company`, `City`, `Sector`, `DepartmentId`, `CreatedBy`; `dateFrom` / `dateTo` as whole days in the app time zone on `CreatedAt`; sort by the chosen field then `_id` descending; page; returns `{ items, total }`.
- `listAllContacts(scope, filters)`: the same filters, newest first, no paging (export).
- `quickSearch(scope, q, limit = 20)` → `{ items, total }`. `q` = digits normalized and trimmed.
  1. Fewer than 2 characters → empty.
  2. Only `+ digits space - ( ) .` with 3+ digits → regex on `_mobiles` using the digits with a leading `00964`, `964` or `0` removed (if that leaves nothing, the digits as typed); newest first. Office and fax numbers in `Notes` are not found this way.
  3. Contains `@` → regex on `_emails` (lowercase); newest first. In steps 2 and 3 the query is always escaped before it goes into a regex, and an empty pattern is never run.
  4. Otherwise Atlas Search `compound.should` (at least one must match), with the scope in `compound.filter`:
     - exact-prefix autocomplete on `FullName` (boost 6) and `Company` (boost 4);
     - fuzzy autocomplete (`maxEdits: 1, prefixLength: 1`) on `FullName` (4), `Company` (3), `Position` (2);
     - fuzzy text on `FullName, Company, Position, City, Notes, Email` (`maxEdits` 2 when `q` has 5+ characters, else 1; `prefixLength: 1`; boost 2);
     - text on the `ar` sub-field of `FullName, Company, Position, City, Notes`.
     The total comes from `$searchMeta` with the **same** compound, including the scope filter.
- `searchContacts(scope, params)` (Ask AI): each of `FullName`, `Position`, `Company`, `City` given → a `must` clause (fuzzy text on the field, or text on its `ar` sub-field); `text` → a `must` clause over all text fields; `Sector` → `equals` filter; dates → `range` filter on `CreatedAt` (whole days in the app time zone); plus the scope filter; limit ≤ 20. No parameters at all → the newest contacts.
- `getContact(scope, id)`; `getContactsByIds(scope, ids)` (keeps the order of `ids`, drops invalid, unknown and out-of-scope ids).
- `insertContacts(writer, inputs, source)`: refuse invalid emails; `cleanContact`; add match keys, `DepartmentId`, `CreatedBy`, `UpdatedBy`, dates; insert; audit.
- `updateContact(writer, id, patch)`: refuse invalid emails; find within the writer's scope; merge; `cleanContact`; recompute match keys; set `UpdatedBy`, `UpdatedAt`; audit with the previous document.
- `deleteContact(writer, id)`: delete within scope; audit.
- `listValues(scope, field, max?)`: distinct non-empty values with counts, most used first.
- `listCreators(scope)`: the users who added contacts in scope, with counts; contacts added by scripts are not listed.
- `findDuplicates(departmentId, contacts)`: marks a contact with `duplicateOfId` / `duplicateOfName` when a saved contact **in the same department** shares a mobile or email, and with `duplicateInBatch` (index) when an earlier contact in the batch does.
- `deleteAllContacts()`: empties the `contacts` collection. It refuses unless the database name contains `test` or is `EVAL_DB`. Used only by `seed --reset` and `eval:search`; no route calls it.

### 8.7 `contacts/export.ts`
- Columns: the 8 fields, then `Department` (High Management only), `Source`, `CreatedAt`. Table exports are newest first.
- UTF-8 with BOM and CRLF line ends, so Excel shows Arabic correctly. Every cell quoted, inner quotes doubled.
- A cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading tab: prevents formula injection and stops Excel turning `+9647…` into `9.6E+12`.

### 8.8 `contacts/vcard.ts`
vCard 3.0 with CRLF line ends, lines folded at 75 bytes (never inside a character): `FN` (FullName, else Company, else first mobile, else first email, else "Contact"), `N:;<FullName>;;;` (the name is never split), one `TEL;TYPE=CELL` per mobile, one `EMAIL;TYPE=INTERNET` per email, `ORG`, `TITLE`, `ADR;TYPE=WORK:;;;<City>;;;`, `NOTE`. Values escape `\`, `;`, `,` and line breaks. File name: Latin letters and digits of the name joined by `-`, or `contact.vcf`.

### 8.9 `contacts/import.ts` and `scripts/import-csv.ts`
`npm run import:csv -- <file.csv> --department "<name>" [--dry-run] [--map FullName="Display Name"]`
1. Decode UTF-8 (with or without BOM) or UTF-16 (LE / BE). Parse RFC 4180 CSV; the delimiter (`,` `;` or tab) is detected from the first line.
2. Map header cells to the 8 fields by English and Arabic aliases (for example `name`, `full name`, `الاسم` → FullName; `phone`, `mobile`, `الهاتف` → Mobile; `organization`, `الشركة` → Company), compared after `foldArabic`. `--map` overrides. Print the mapping. Stop if neither a name nor a company column is found.
3. Each row → contact: an unknown sector goes to `Notes` as `Original sector: …` and the sector becomes the default; invalid emails go to `Notes` as `Unreadable email: …` (there is no review step); unmapped columns with values go to `Notes` as `Header: value`; then `cleanContact`.
4. Skip rows with no name, company, mobile and email. Skip duplicates already in that department or earlier in the file (batches of 500 through `findDuplicates`).
5. Insert with `source: "import"` unless `--dry-run`. Print imported / skipped / failed and write the full report to `import-reports/`.

### 8.10 `search/ask.ts` — `ask(scope, question, today = new Date())`
Empty → `VALIDATION` "Type a question first."; over 500 characters → `VALIDATION`. Then `runToolLoop` with the search prompt, user text `Today is YYYY-MM-DD.\nQuestion: <question>` (the date in the app time zone), `searchTools(scope)`, the final tool, 3 rounds. Then `getContactsByIds(scope, result.contactIds)`. Returns `{ answer, contacts, rounds }`.

Tools are defined in `tools.md` §6.

### 8.11 PWA
- `app/manifest.ts`: name "Business Cards Manager", short name "Cards", `display: standalone`, theme colour `#ac103d`, icons 192, 512 and maskable 512.
- `public/sw.js` caches only `/offline.html` and one icon. Navigation requests go to the network and fall back to the offline page. **Contacts and app pages are never cached.**
- The service worker is registered in production builds only. Phones need HTTPS to install.

---

## 9. Prompts

Each prompt file exports `{ id, text }`. The texts below are the versions in use (version 1, except `extract-photo`, which is version 2). Do not change wording without making a new version file and re-running the eval.

### 9.1 `sector-rules.v1` (inserted into the three prompts where `{SECTOR_RULES}` appears)

```
Sector: exactly one of these 6 values, chosen from the organization (and job title when there is no organization). Never leave it empty.
  - "Ministries & Government": ministries, government offices and directorates, governorates, parliament, courts and judicial councils, the presidency, and other state bodies that are not companies.
  - "Businesses & Financial Institutions": companies of any kind (private or state-owned), banks, telecoms, oil and energy companies, construction, trading, media and TV channels, airlines, hospitals, clinics, medical centers, pharmaceutical companies, hotels.
  - "Embassies & International Organizations": embassies, consulates, UN agencies (UNICEF, UNESCO, UNDP, WFP, UNHCR…), the EU, the World Bank, and other intergovernmental bodies.
  - "Universities & Education": universities, colleges, faculties, schools, institutes, training and research centers.
  - "NGOs & Civil Society": local and international NGOs, charities, foundations, associations, unions, syndicates, chambers of commerce, community groups.
  - "Professional & Other Contacts": individual professionals and small offices named after a person (law offices, lawyers, engineering or accounting consultancies, freelancers), and anyone whose organization is missing or unclear.
```

### 9.2 `structure-text.v1`

```
You turn messy, unstructured text into business contacts for a university office in Iraq.
The text may be Arabic, English, or both mixed: copied email signatures, WhatsApp messages, notes, lists, or lines from business cards.

Return every distinct person or organization contact found in the text. Each contact has exactly these 8 fields:
- FullName: the person's name as written. If the person's name appears in both Arabic and English, write "Arabic / English" (e.g. "أحمد علي / Ahmed Ali").
- Position: job title, as written. Bilingual titles use the same "Arabic / English" format.
- Mobile: mobile phone number(s) as written (digits may be Arabic-Indic). Several numbers: separate with ", ".
- Company: the organization, as written. Bilingual names use "Arabic / English".
- City: only a city written as a location (address line, "Baghdad", "Erbil, Iraq"). Never take it from a company or organization name ("Basra Oil Company" does not mean City is Basra). If the city is written in both Arabic and English, use the first one written.
- Email: email address(es). Several: separate with ", ".
- {SECTOR_RULES}
- Notes: other useful details that do not fit the fields above — office/landline numbers, fax, extension, website, street address, P.O. box, social handles — each labelled, separated by "; " (e.g. "Office: +964 1 717 0000; Fax: +964 1 717 0001; Website: example.com").

Rules:
- Never invent or guess data. A field with no information in the text is "" (except Sector, which is never empty). Do not translate, transliterate, or correct names; copy them exactly.
- Group lines that belong to the same person into one contact (a name followed by its title, company, phone and email is one contact). Start a new contact when a new person's details begin.
- Numbers labelled office, tel, landline, هاتف المكتب, fax or فاكس go to Notes, not Mobile. Unlabelled numbers that look like mobiles (Iraqi mobiles start with 07 or +9647) go to Mobile.
- A company or department contact without a person's name is still a contact; leave FullName "".
- Ignore greetings, signatures like "Best regards", disclaimers, and anything that is not contact information.
- If the text contains no contact information at all, return an empty list.
```

### 9.3 `extract-photo.v2`

Version 2 (14 Nov 2026) is in use. It differs from version 1 in one line, the City rule. Version 1 read: `- City: only a city printed as a location (address line, "Baghdad", "Erbil, Iraq"). Never take it from a company or organization name ("Basra Oil Company" does not mean City is Basra).` The model then copied the country or district into City (`Baghdad, Iraq`), which cost about half of all misses. `extract-photo.v1.ts` is kept in the repository for comparison.

```
You read a photo of business cards for a university office in Iraq. The photo may contain one card or many (up to about 15), laid out on a table, possibly rotated, angled, overlapping slightly, or under uneven light. Cards may be Arabic, English, or bilingual (Arabic on one half, English on the other).

First count every business card visible in the photo, including partly visible ones. Report that number as cardCount.
Then extract one contact per card, in reading order: top-left to bottom-right, row by row. contacts must contain exactly cardCount entries — one per card, even if a card is hard to read (fill what you can read and leave the rest "").

Each contact has exactly these 8 fields:
- FullName: the person's name exactly as printed. If the card shows the name in Arabic and English, write "Arabic / English" (e.g. "أحمد علي / Ahmed Ali").
- Position: job title as printed; bilingual as "Arabic / English".
- Mobile: mobile number(s) as printed (Iraqi mobiles start with 07 or +9647). Several: separate with ", ".
- Company: the organization as printed; bilingual as "Arabic / English". If the only organization name is in the logo, use the logo text.
- City: the city name only, taken from a location printed on the card (address line). Write the city alone, without country, district or street: "Baghdad, Iraq" → "Baghdad"; "الجادرية - بغداد" → "بغداد". A printed district or street goes to Notes as "Address: …". Never take the city from a company or organization name ("Basra Oil Company" does not mean City is Basra).
- Email: email address(es) as printed. Several: separate with ", ".
- {SECTOR_RULES}
- Notes: everything else useful on the card, each item labelled and separated by "; ": office/landline numbers, fax, extension, website, street address, P.O. box, social handles (e.g. "Office: +964 1 717 0000; Website: example.com").

Rules:
- Never invent or guess. Copy text exactly as printed; do not translate, transliterate, or correct spelling. Anything you cannot read is "" (except Sector, which is never empty).
- Read digits carefully; Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) are fine to copy as printed.
- Numbers labelled office, tel, landline, هاتف, فاكس, fax go to Notes. Numbers labelled mobile, mob, M, موبايل, جوال, or unlabelled mobile-looking numbers go to Mobile.
- Each card is a separate contact even if two cards belong to the same company. Never merge two cards.
- If the photo contains no business cards, return cardCount 0 and an empty list.
```

### 9.4 `search.v1`

```
You help staff of a university office in Iraq find people and organizations in their business-card database.
Contacts have: FullName, Position, Mobile, Company, City, Email, Sector, Notes, and the date they were added.
Values are stored exactly as written on the card — Arabic, English, or "Arabic / English".
How contacts are classified — {SECTOR_RULES}
When a question names a loose category (e.g. "banks", "telecom", "UN", "ministry"), map it to one of these 6 sectors and also search by company or position.

How to answer:
- Work out what the question is after: a person, a position/role, a company, a city, a sector, a time period, or a combination.
- Resolve relative dates ("last week", "this month", "الشهر الماضي") against today's date given in the message, and filter with dateFrom/dateTo.
- Search with spelling variants: Arabic and English forms of names and companies (محمد / Mohammed / Mohamed / Muhammad; آسياسيل / Asiacell), typos, and partial names. For roles and topics include synonyms in both languages (e.g. marketing / تسويق / communications / إعلام; HR / الموارد البشرية).
- When the question names a company, city or sector loosely, use list_values to find the exact stored value.
- You can call several searches in the same turn. You have at most 2 rounds of searching, so search broadly in parallel.
- Finish with final_answer: a one-line answer in the language of the question, and the ids of the matching contacts, best match first. Only include contacts that actually match; return an empty list when nothing matches. Never make up contacts or ids.
```

The prompts ask for `", "` between several mobiles or emails; `cleanContact` converts that to ` | `.

### 9.5 If a model misses a target
Make a new version, one change at a time, and re-run the eval. Changes that usually help small models:
1. One short worked example of input → output JSON.
2. For Ask AI: "Call at most 3 tools per turn" and an explicit example of a `final_answer` call (some models answer in prose instead).
3. For photos: "Read one card at a time; do not continue a card's text into the next card."
4. A shorter prompt: remove rules the evals show the model already follows.

---

## 10. Evals and fixtures

Fixtures are written as part of the build (formats and examples in `tools.md` §10):
- `tests/fixtures/sample-contacts.json`: 30 contacts — Arabic, English and bilingual names; all 6 sectors; several Iraqi cities; mobiles written in different ways.
- `tests/fixtures/text/NN-name.txt` + `.expected.json`: 10 samples — English signature, Arabic signature, WhatsApp list, bilingual card lines, two signatures in one text, Arabic numbered list, company without a person, meeting notes, CSV-like lines, mixed Arabic-Indic digits.
- `tests/fixtures/photos/*.jpg` + `.expected.json`: 10 **synthetic** photos rendered by `scripts/make-photo-fixtures.ts` (SVG cards composited with `sharp` on a table background): 1, 4, 8 and 12 cards; English, Arabic and bilingual; rotated 90°, angled, uneven light, dark table. Real phone photos can be dropped in the same folder with an expected file and are picked up. Arabic text is drawn with a font file kept in `tests/fixtures/fonts/` (never a system font), and the rendered JPGs are committed, so every machine evaluates the same pixels. Synthetic photos are easier than real ones: at least 3 real phone photos of test cards are added before the photo target counts as met, and their result is reported separately.
- `tests/fixtures/search/questions.json`: 20 Ask questions and 12 quick search queries, each with the `FullName` it must find among the 30 sample contacts.
- `tests/fixtures/import/sample.csv`: a CSV with Arabic headers, duplicates, an empty row and an invalid email.

**Scoring** (`scripts/eval-score.ts`, one rule for all evals)
- Both sides pass through `cleanContact` first. Expected contacts are paired with actual ones greedily by the number of matching key fields.
- Key fields: `FullName`, `Company`, `Mobile`, `Email`.
- Text fields: equal after `foldArabic`, punctuation → space, whitespace collapsed. A bilingual expected value (`a / b`) is correct when every part appears in the actual value.
- `Mobile` / `Email`: the same **set** of values. `Sector`: exact. `Notes`: every labelled value of the expected notes appears somewhere in the actual notes (spaces ignored).
- Empty expected + empty actual = correct. A value where none was expected, or a missing value, = wrong. An unpaired expected contact counts all its fields wrong.
- Reports: per case, per field, key-field accuracy, all-field accuracy, missing and extra contacts, and every miss.

**Scripts**
- `eval:text` and `eval:photo`: run every fixture (an optional argument keeps only names containing it), score, print, save JSON to `eval-results/`, exit 0 only when the target is met.
- `eval:search`: uses its **own database** (`EVAL_DB`, default `cards_eval`, never `MONGODB_DB`). It runs `setupDatabase`, deletes every contact there (`deleteAllContacts`), inserts the 30 sample contacts into High Management, and waits until Atlas Search finds them. Quick search: the expected name must be in the top 3 and each query under 300 ms, measured as the time of the `quickSearch` call: the median of 5 runs after one warm-up run. Ask: the expected name must be in the top 3 within 3 rounds. `--quick-only` skips Ask.
- For free models, all three: `--limit N`; a pause between calls to stay under 20 requests a minute; the report prints the configured model **and the model that answered**, the JSON mode, and the counts of retries, 429s and failures; a fixture that fails on an API error counts as failed and is listed separately.
- Budget: text 10, photo 10, search up to 60 requests. Not all on one day without the $10 credits.

**Targets:** text key fields ≥ 95%; photo card count right on ≥ 9/10 and all fields ≥ 90%; Ask ≥ 90% top 3; quick search 12/12 top 3 under 300 ms.

---

## 11. Phases

### Execution Rules
- One phase at a time, in order. Finish only when all **Done when** checks pass and `npm run check` is green.
- After each phase: update **Progress**, commit, stop, report (built / tested / numbers / issues), wait for approval.
- No changes to Fixed Decisions or Folder Structure without asking.
- A missed accuracy target is not hidden or worked around: report the numbers and the misses, and wait.

### Phase 0 — Setup
1. `.gitignore` includes `.env*` except `.env.example`, plus `eval-results/`, `import-reports/` and `tests/mock-ai/requests.log`.
2. Next.js 16 app (TS strict, Tailwind, shadcn/ui, ESLint, Prettier). Install `zod`, `mongodb`, `sharp`, `heic-convert`, `vitest`, `tsx`. **No AI SDK.**
3. Folder structure; `lib/config.ts` with every key of `tools.md` §4 and the free-only check; `.env.example`; `instrumentation.ts`.
4. `dev` / `start` bind to `127.0.0.1`. `next.config.ts` as in Fixed Decisions. GitHub Actions workflow running `npm run check` (the `test:db` job is added in Phase 1).
5. `shared/errors.ts`, `shared/api-response.ts`, `lib/api.ts`.
6. Layout with the sidebar and empty pages.

**Done when:** the app runs on localhost only; missing or invalid env stops startup with one readable error listing every problem; a paid model id is refused unless `AI_ALLOW_PAID=true`; `npm run check` passes.

### Phase 1 — Accounts and data
1. Atlas cluster (manual step — see `instructions.md`), `db/mongo.ts`, `db/setup.ts`, `search-index.json`.
2. `accounts/`, `audit/`, `proxy.ts`, login page, `users:add-admin` (asks for the password in the terminal so it is not in the shell history).
3. `contact.schema.ts`, `normalize.ts`, `contacts.repo.ts`, `export.ts`, `vcard.ts`.
4. Routes: auth, me, contacts, search, admin. `seed.ts` (`--department`, `--sample`, `--count N`, `--reset` only when the database name contains `test`) and `sample-contacts.json`.
5. Unit tests: `normalize` (Iraqi and foreign mobiles, Arabic-Indic digits, numbers kept as written, several emails, invalid emails, Arabic text), `export` (BOM, quoting, `+964` cells), `vcard`, session tokens, passwords, permissions, config.
6. DB tests with three departments (High Management, A, B) sharing some of the same phone numbers and names:
   - For every row of the scope table (§6.6): A sees only A, nothing from B or High Management; High Management sees all.
   - Opening, editing or deleting another department's contact returns `NOT_FOUND` and changes nothing.
   - A High Management editor can edit a contact in A (it stays in A) and delete it.
   - The same phone number in A and B gives no duplicate warning across departments; within A it does.
   - `DepartmentId` sent in a save or edit request is ignored.
   - Quick search with regex characters (`.*`, `(`, `a@.*`) or with only `964` does not fail and does not return every contact.
   - Each role can do only what the roles table allows, enforced at the API, not only by hidden buttons.
   - A deactivated user is refused on the next request and the cookie is deleted; an unknown username gets the same message as a wrong password.
   - 5 wrong passwords lock the username for that address; a password reset lifts the lock and ends the user's sessions; an inactive department's people cannot sign in.
   - Admins must be in High Management; nobody can remove their own admin access; the last active admin stays.

**Done when:** contact routes work with the 30 sample contacts; quick search finds "Moh" → "Mohammed", "Mohamad" → "Mohammed", "احمد" → "أحمد" and a partial mobile number in < 300 ms (median `quickSearch` time, measured as in §10); every DB test above passes (`npm run test:db` green, locally and in the GitHub Actions job on Atlas Local); an old session after a password change lands on the login page once, with no reload loop.

### Phase 2 — AI module
1. `ai/client.ts`, `json.ts`, `call-json.ts`, `tool-loop.ts`, `log.ts`.
2. `tests/mock-ai/server.mjs`.
3. Unit tests with mocked `fetch`:
   - `callJson`: valid output; fenced JSON accepted; invalid → retry → valid; invalid twice → `AI_FAILED`; `length` and `content_filter` not retried; image sent as a data URL to the vision model; `prompt` mode sends no `response_format`; `max_tokens` capped; `length` with empty content gives the "ran out of room" message.
   - `client`: per-minute 429 retried then succeeds; daily 429 not retried → `TOO_MANY_REQUESTS`; 5xx retried; HTTP 200 with an `error` body fails; timeout; no raw error text in the `AppError` message; text fallbacks sent as `models` on text requests and vision fallbacks on image requests; the deadline shortens the timeout, stops further retries and gives the timed-out message.
   - `runToolLoop`: several tool calls in one turn; unparseable arguments and unknown tools answered as errors; early final answer; prose final answer accepted; forced final round; nothing valid → `AI_FAILED`.
   - `json`: keyword stripping; strict flags only in strict mode; loose parsing cases.
4. `scripts/ai-models.ts` and `scripts/ai-smoke.ts`.

**Done when:** unit tests pass; `npm run ai:models` lists free models per ability and says whether the configured ones qualify; `npm run ai:smoke` returns one validated contact from a real free model; `npm run ai:smoke -- --tools` finishes a tool loop with a stub tool on the text model.

### Phase 3 — Add from Text
1. `sector-rules.v1.ts`, `structure-text.v1.ts`, `structure-text.ts`.
2. `accounts/ai-usage.ts` and `requireAccess(…, { ai: true })`; route `api/extract/text`; page; `ReviewTable`; **Add manually**; save through `POST /api/contacts`.
3. The 10 text fixtures; `eval-score.ts` (with unit tests); `npm run eval:text`.

**Done when:** re-submitting the same text flags its contacts as duplicates; the same person twice in one text flags the in-batch duplicate; an invalid email blocks the save; a daily-cap error shows the friendly message and the manual path still saves; a person over `AI_USER_DAILY_LIMIT` gets the per-user message while another person can still use the AI, and the count starts again the next day (DB test); the eval runs and reports numbers.

### Phase 4 — Model selection
1. From `ai:models`, shortlist up to 3 text models (tool calling; structured outputs preferred) and up to 3 vision models (image input). Every text candidate must pass `npm run ai:smoke -- --tools` first: the same model answers Ask AI in Phase 6, and the model list alone does not prove that tool calling works.
2. For each, run `eval:text -- --limit 3` in `schema` mode; if the model rejects it, in `prompt` mode.
3. Pick `AI_MODEL_TEXT`, `AI_JSON_MODE` and up to 2 `AI_FALLBACK_MODELS_TEXT`, then run the full `eval:text`. The vision model is confirmed in Phase 5.

**Done when:** `eval:text` ≥ 95% on key fields with the chosen model (below that: report and wait); the candidates, their results, the date and the chosen values are in Progress and as comments in `.env.example`.

### Phase 5 — Add from Photo
1. `prepare-image.ts`, `extract-photo.v1.ts`, `extract-photo.ts`, `lib/shrink-image.ts`.
2. Route `api/extract/photo`; page.
3. `make-photo-fixtures.ts` and the 10 photo fixtures; `npm run eval:photo`; choose `AI_MODEL_VISION` the same way as in Phase 4.

**Done when:** card count correct on ≥ 9/10 synthetic photos and field accuracy ≥ 90%; the real phone photos are run and reported separately (§10); an 8 MB iPhone HEIC extracts on a local run; on Vercel, a large phone photo extracts after the browser shrinks it, and an upload the host rejects shows the "too large to upload" message. **Expected weak spot:** 8- and 12-card photos. If they fail, report results per card count and wait for the owner to choose: accept and show "up to N cards per photo" on the page, another model, or the "detect → crop → extract per card" upgrade (§12).

### Phase 6 — Explore
1. `search/tools.ts`, `search.v1.ts`, `search/ask.ts`; route `api/ask`.
2. `SearchBar`, `Overview`, `ContactTable`, `ContactForm`, filters, export button, vCard button.
3. `questions.json`; `npm run eval:search`.

**Done when:** ≥ 90% of Ask questions return the right contact in the top 3 within 3 rounds (below that: report and wait; one option is a separate `AI_MODEL_SEARCH`, §12); quick search 12/12 under 300 ms; the table stays responsive with 12,000 seeded contacts; Ask as department A never returns a contact of department B (DB test with a mocked AI that returns B's ids).

### Phase 7 — Import, admin pages, PWA, polish
1. `import.ts`, `scripts/import-csv.ts`, with unit tests and the sample CSV.
2. Admin pages (users, departments, activity), My account, Team.
3. PWA: manifest, icons, service worker, offline page.
4. Loading, empty and error states on every page; unsaved-work guards; toasts; the AI messages of §2.8.
5. `README.md`: setup from zero, OpenRouter key and privacy setting, choosing models, env, scripts, troubleshooting.

**Done when:** the CSV import gives a clean report on the sample file; all targets hold at 12,000 contacts; the README runs the project from a fresh clone with only an OpenRouter key and a MongoDB URI; sign-in works with two accounts in different departments, each seeing only its own contacts; the app is deployed on Vercel, Add from Text, Add from Photo and Ask AI work there, and it installs on a phone over HTTPS.

---

## 12. Future Upgrades

| Upgrade | How |
|---|---|
| Many cards per photo at higher accuracy | "Detect → crop → extract per card" inside `extract-photo.ts` (costs 1 request per card) |
| Paid model for better accuracy | `AI_ALLOW_PAID=true` + a paid model id. No code change |
| A model running on the machine (Ollama, LM Studio) | They speak the same chat completions format: point `OPENROUTER_BASE_URL` at them |
| Different model for Ask AI | Add `AI_MODEL_SEARCH`; `runToolLoop` reads it |
| Cache Ask answers for repeated questions | Small in-memory map in `search/ask.ts`, keyed by scope + question + day (saves free requests) |
| New field | Add to `contact.schema.ts` + search index + new prompt versions |
| New sector | Add to `SECTORS` + UI colours + aliases in `normalize.ts` + new `sector-rules` and prompt versions + fixtures; re-run evals |
| Telegram / WhatsApp bot | New `src/channels/<name>/` calling the same module functions |
| Microsoft sign-in | A second way to create the same session; users, departments and roles do not change |
| Backups | A paid Atlas tier; change `MONGODB_URI` only. The free tier has no automatic backups and deletes are permanent |

---

## 13. Progress

| Phase | Status | Notes |
|---|---|---|
| 0 — Setup | Done (13 Nov 2026) | Next.js 16.4.6, React 19.3, Tailwind 4.3, Zod 4.6, mongodb 7.9, Vitest 5. shadcn/ui's registry was not reachable from the build machine, so the few `components/ui/*` primitives are hand-written in the shadcn style (same Tailwind classes, no extra dependency). `maxDuration` must be a build-time constant, so the AI routes use 300 s and `config.ts` caps `AI_DEADLINE_MS` at 280 s (§3, §7). |
| 1 — Accounts and data | Done (13 Nov 2026) on Atlas Local; **owner still creates the Atlas cluster** | `npm run check` green; `npm run test:db` 35/35 on Atlas Local (Docker). Sign-in, scoped search and the 30 sample contacts checked on a local production build. Quick-search timing: see Phase 6 (`eval:search -- --quick-only`). `GET /api/me` also returns `timeZone`. `scripts/db-setup.ts` is the entry of `npm run db:setup`. The GitHub Actions `test-db` job is written but has not run yet (no push to GitHub Actions from the build machine was checked). |
| 2 — AI module | Done (14 Nov 2026) | 57 unit tests with mocked `fetch`. On the real API: `ai:models` lists 14 free models; `ai:smoke` and `ai:smoke -- --tools` pass on `particle-ai/particle-1:free`, `nvidia/nemotron-3.5-super-vl:free` and `inclusionai/ling-3.2-flash:free` in `schema` mode. Confirmed live: `model` + `models` together work (a fallback answered 1 of 51 Ask requests), `response_format` json_schema + the `response-healing` plugin are accepted. **Not confirmed:** the wording of the daily-cap 429 (never hit; `isDailyLimit` in `client.ts` still guesses it). The attribution header sent is `X-OpenRouter-Title`. `provider.require_parameters` is sent only with `tools` or `response_format`. |
| 3 — Add from Text | Done (14 Nov 2026) | `eval:text`, `particle-ai/particle-1:free`, `schema` mode, all 10 fixtures (20 contacts): **key fields 100%**, all fields 98.8% (2 Notes misses), 10 requests, 0 retries. DB tests prove duplicates, the invalid-email block, the daily-cap message with manual add, and the per-user limit. Page checked in a browser against the mock AI. |
| 4 — Model selection | Done (14 Nov 2026) — **owner approves the choice** | Candidates (all pass `ai:smoke` and `ai:smoke -- --tools`, `schema` mode), `eval:text -- --limit 3`: `particle-ai/particle-1:free` key 100% / all 100%, ~1–2 s per call; `nvidia/nemotron-3.5-super-vl:free` key 100% / all 95%, ~8 s; `inclusionai/ling-3.2-flash:free` key 80% (1 of 3 timed out), ~12 s. **Chosen:** `AI_MODEL_TEXT=particle-ai/particle-1:free`, `AI_JSON_MODE=schema`, `AI_FALLBACK_MODELS_TEXT=nvidia/nemotron-3.5-super-vl:free,inclusionai/ling-3.2-flash:free`. Full `eval:text`: key 100%, all 98.8% (target ≥ 95%: met). All free models list `reasoning` today, so none without it could be preferred. |
| 5 — Add from Photo | Synthetic target met (14 Nov 2026); **real phone photos, HEIC and Vercel checks waiting for the owner** | `eval:photo`, 10 synthetic photos (55 cards), `particle-ai/particle-1:free`, `schema` mode, `AI_MAX_TOKENS=32000`. **`extract-photo.v2` (in use): card count 10/10, all fields 95.5%** (target ≥ 9/10 and ≥ 90%: met), key fields 93.6%, 20 misses, 10 requests, 0 retries. Per field: FullName 96.4%, Position 98.2%, Mobile 87.3%, Company 98.2%, City 100%, Email 92.7%, Sector 100%, Notes 90.9%. The remaining misses are real misreads: one or two digits of a mobile (mostly Arabic-Indic digits on Arabic cards) and a letter in an email, so staff must check numbers on the review screen. History: `extract-photo.v1` scored 10/10 and 85.9% (62 misses, about half of them City written with the country or district); the owner chose a prompt v2 with one change, the City rule. With the default `AI_MAX_TOKENS=8000` the model was cut off on 1–3 photos per run (`length`), so photos need the higher limit. `nvidia/nemotron-3.5-super-vl:free` (v1, 32000): 9/10 and 72.0%. **v3 tried and dropped (14 Nov 2026):** v2 plus one change, the digits rule rewritten as "Read every phone number one digit at a time, in the order printed, and copy each digit exactly: never repeat, skip, swap or guess a digit… Read email addresses letter by letter in the same way." Result: card count 10/10, all fields 93.2%, Mobile still 87.3% (7 wrong mobiles, the same cards as before), Notes fell to 76.4%. No gain, so v2 stays in use and the v3 file was not kept. The wrong mobiles are runs of repeated digits (`1112233` read as `1113333`), mostly Arabic-Indic: a limit of this model on small text, not of the wording. What would help: fewer cards per photo, or the per-card upgrade (§12). Not run: the 3 real phone photos (§10: the target does not fully count without them), an 8 MB iPhone HEIC, the Vercel upload-limit check. |
| 6 — Explore | Done (14 Nov 2026) | `eval:search`, `particle-ai/particle-1:free`, `schema` mode: **Ask 20/20 in the top 3** within 3 rounds (target ≥ 90%: met), 51 requests, 0 retries, 0 failures. **Quick search 12/12**, slowest median 59 ms (Atlas Local). With 12,033 contacts (Atlas Local): table pages 14–24 ms, filters 3 ms, quick search 14–63 ms. DB test: Ask as department A never returns a contact of B. Explore page checked in a browser, including phone width. Still to repeat on the real Atlas M0 cluster. |
| 7 — Import, admin, PWA, polish | Code done (13 Nov 2026); **deploy and phone install waiting for the owner** | CSV import: clean report on the sample file (7 imported, 1 empty row and 1 duplicate skipped, 0 failed). Admin pages, My account, Team (placeholder names), manifest, icons (placeholder), service worker and offline page, README. `npm run check` green (137 unit tests); `npm run test:db` green (49 tests). Not done: Vercel deploy, install on a phone, owner's logo / colours / Team names, the 12,000-contact check on the real Atlas M0 cluster. |

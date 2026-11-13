# tools.md — Everything the app uses, and how the AI layer talks to OpenRouter

This file is the reference for: outside services, libraries, project commands, env keys, the AI layer, the tools the model may call during Ask AI, the OpenRouter request formats, the search index, and the test fixtures.

OpenRouter details were checked against its documentation in November 2026. Limits and the free model list change: verify at <https://openrouter.ai/docs> before relying on them.

---

## 1. Services and accounts

| Service | Used for | Cost | Needed |
|---|---|---|---|
| **OpenRouter** (<https://openrouter.ai>) | All AI calls (text, photo, Ask AI) | Free models: $0. An optional one-time $10 of credits raises the daily free cap from 50 to 1,000 requests | API key (`OPENROUTER_API_KEY`) |
| **MongoDB Atlas** free tier (M0) | Contacts, users, departments, activity log, Atlas Search | Free | Connection string (`MONGODB_URI`) |
| MongoDB **Atlas Local** (Docker) | Tests and fully local runs (it includes Atlas Search) | Free | Docker |
| **Vercel** | Production hosting (a local run is only for testing before a deploy) | Free tier | Account; env values set in the project |
| **GitHub** | Repository + Actions running `npm run check` | Free | — |

Plain MongoDB Community does not work: quick search and Ask AI need **Atlas Search** (`$search`), which only Atlas and Atlas Local provide.

## 2. Libraries

| Library | Used for |
|---|---|
| `next` 16, `react` 19, TypeScript strict | App, pages, API routes |
| `tailwindcss` 4, shadcn/ui, `lucide-react` | UI |
| `zod` 4 | One schema for AI output, API input and DB writes; `z.toJSONSchema()` for output and tool schemas |
| `mongodb` | Official driver, no ORM |
| `sharp`, `heic-convert` | Photo preparation and synthetic photo fixtures |
| `vitest`, `eslint`, `prettier`, `tsx` | Tests, lint, scripts |
| **No AI SDK** | OpenRouter is called with Node's built-in `fetch` from one file, `src/modules/ai/client.ts` |

Why no SDK: the app needs one endpoint, and OpenRouter-only fields (`models`, `provider`, `plugins`) are plain JSON. A small `fetch` wrapper with timeout and retries is little code and easy to mock.

## 3. Project commands

Scripts run with `node --env-file-if-exists=.env.local --import tsx <file>`.

| Command | What it does | Free AI requests used |
|---|---|---|
| `npm run dev` | Dev server on `http://127.0.0.1:3000` | — |
| `npm run build && npm start` | Production build on your own machine, localhost only (a test before deploying) | — |
| `npm run check` | `lint` + `typecheck` + unit tests | 0 (mocked) |
| `npm run test:db` | DB tests (`MONGODB_DB` must contain `test`) | 0 |
| `npm run db:setup` | Indexes + Atlas Search index | 0 |
| `npm run db:seed -- --department <name> --sample` | The 30 sample contacts | 0 |
| `npm run db:seed -- --department <name> --count 12000` | Synthetic contacts for load tests | 0 |
| `npm run db:seed -- --reset …` | Deletes all contacts first; only when the database name contains `test` | 0 |
| `npm run users:add-admin -- <username> --name "Full Name"` | First admin + High Management; asks for the password | 0 |
| `npm run import:csv -- <file> --department <name> [--dry-run] [--map Field="Header"]` | Import a CSV | 0 |
| `npm run fixtures:photos` | Renders the synthetic photo fixtures | 0 |
| `npm run ai:models` | Lists free models by ability and checks the configured ones | 0 (public endpoint) |
| `npm run ai:smoke` | One real call through `callJson` | 1 |
| `npm run eval:text [-- <name>] [--limit N]` | Accuracy of text → contacts. `<name>` keeps only fixtures whose name contains it | 10 (+ retries) |
| `npm run eval:photo [-- <name>] [--limit N]` | Accuracy of photo → contacts | 10 (+ retries) |
| `npm run eval:search [-- --limit N]` | Ask AI (20 questions) + quick search (12 queries). Runs on its own database `EVAL_DB` and **deletes every contact there first** | up to 60 |
| `npm run eval:search -- --quick-only` | Quick search part only | 0 |

All three evals together are about 80 requests: more than the 50-a-day cap without credits. Run them on different days, use `--limit`, or buy the one-time $10 of credits.

## 4. Environment keys

All keys are validated at startup in `src/lib/config.ts` (Zod). Empty strings count as missing. One readable error lists every problem.

| Key | Required | Default | Meaning |
|---|---|---|---|
| `AUTH_SECRET` | Yes | — | Signs session cookies, at least 32 characters. Changing it signs everyone out |
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter key |
| `AI_MODEL_TEXT` | No | `openrouter/free` | Model for Add from Text and Ask AI. Must support tool calling |
| `AI_MODEL_VISION` | No | `openrouter/free` | Model for Add from Photo. Must accept image input |
| `AI_FALLBACK_MODELS` | No | empty | Comma-separated model ids OpenRouter tries if the main one is down or rate-limited (keep it short: OpenRouter limits the list length) |
| `AI_JSON_MODE` | No | `schema` | `schema` = `response_format: json_schema`; `prompt` = schema written into the prompt (for models without structured outputs) |
| `AI_DATA_COLLECTION` | No | `allow` | `deny` = only providers that do not collect prompts (fewer free endpoints) |
| `AI_ALLOW_PAID` | No | `false` | `true` allows a model id that is not free |
| `AI_TIMEOUT_MS` | No | `90000` | Timeout of one AI request |
| `AI_MAX_TOKENS` | No | `8000` | Upper limit for `max_tokens` on every request. Lower it if a model rejects the request; raise it if 12-card photos stop with `length` |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | Only for tests (mock server) |
| `MONGODB_URI` | Yes | — | Must start with `mongodb://` or `mongodb+srv://` |
| `MONGODB_DB` | No | `cards` | Database name |
| `EVAL_DB` | No | `cards_eval` | Database used (and emptied) by `eval:search` only |
| `MAX_TEXT_CHARS` | No | `20000` | Longest text for Add from Text |
| `MAX_IMAGE_MB` | No | `20` | Largest photo upload (max 50) |

"Free" means the id ends in `:free` or is `openrouter/free`. `config.ts` refuses anything else in `AI_MODEL_TEXT`, `AI_MODEL_VISION` and `AI_FALLBACK_MODELS` unless `AI_ALLOW_PAID=true`.

## 5. The AI layer (`src/modules/ai/`)

The rest of the app sees only these two functions.

```ts
// call-json.ts
type Prompt = { id: string; text: string };                 // from a *.vN.ts file
type JsonImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }; // base64

callJson<S extends z.ZodType>(opts: {
  prompt: Prompt;
  input: string;
  schema: S;
  image?: JsonImage;      // present → AI_MODEL_VISION, absent → AI_MODEL_TEXT
  maxTokens?: number;     // default 16000, always capped at AI_MAX_TOKENS
}): Promise<z.infer<S>>;  // throws AppError("AI_FAILED") or AppError("TOO_MANY_REQUESTS")

// tool-loop.ts
type LoopTool<S> = { name: string; description: string; schema: S; run: (input: z.infer<S>) => Promise<unknown> };
type FinalTool<S> = { name: string; description: string; schema: S };

runToolLoop<F extends z.ZodType>(opts: {
  prompt: Prompt;
  userText: string;
  tools: LoopTool[];
  final: FinalTool<F>;
  maxRounds?: number;     // default 3
}): Promise<{ result: z.infer<F>; rounds: number; calls: { name: string; input: unknown; error?: string }[] }>;
```

| File | Job |
|---|---|
| `client.ts` | `chat(body)`: the only `fetch` to OpenRouter. Adds auth, `models` fallbacks, `provider` options, the `max_tokens` cap, timeout, retries; maps errors to `AppError` |
| `call-json.ts` | One prompt → one validated object, one corrective retry |
| `tool-loop.ts` | Bounded tool loop for Ask AI |
| `json.ts` | `toProviderSchema(zodSchema, { strict })` and `parseJsonLoose(text)`. `strict: true` only for `response_format`; `strict: false` for tool parameters |
| `log.ts` | One JSON line per call (`[ai] {…}`): time, prompt id, model that answered, latency, tokens, attempt, finish reason, ok, error. Never bodies. Silent under Vitest |

## 6. Ask AI tools (what the model may call)

The model can only **read**, through two tools, inside the signed-in person's department scope. The scope is fixed in the handler on the server and is never a tool input.

| Tool | Input | Handler | Returns |
|---|---|---|---|
| `search_contacts` | `{ text?, FullName?, Position?, Company?, City?, Sector?, dateFrom?, dateTo?, limit? }` | `contacts.repo.searchContacts(scope, …)`, limit ≤ 20 | `{ count, results: [{ id, FullName, Position, Company, City, Sector, Email, Mobile, Added }] }` (`Added` = `YYYY-MM-DD`) |
| `list_values` | `{ field: "Company" \| "City" \| "Sector" }` | `contacts.repo.listValues(scope, field, 150)` | `{ field, values: ["Asiacell (12)", …] }` |
| `final_answer` | `{ answer: string, contactIds: string[] }` | ends the loop | — |

Descriptions:
- `search_contacts`: "Search the contacts database. Every given field must match (fuzzy, typo-tolerant); `text` matches any field. Returns up to 20 contacts with their id. Arabic and English values are stored as written, so search both spellings when a name could be written either way."
- `list_values`: "List the distinct values stored for Company, City or Sector, with how many contacts have each. Use it to find the exact stored spelling before searching."
- `final_answer`: "Give the final answer and the ids of the matching contacts (best first). Always end with this." — `answer`: "One short sentence answering the question, in the question's language."; `contactIds`: "Ids of matching contacts, best match first. Empty if none."

Definitions are built from Zod schemas in `src/modules/search/tools.ts` with `toProviderSchema(schema, { strict: false })` and sent in OpenAI function format. Every `search_contacts` field stays **optional** (no `required` list, no `strict`): the model sends only the fields it needs.

```json
{
  "type": "function",
  "function": {
    "name": "search_contacts",
    "description": "Search the contacts database. …",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string", "description": "Free text matched against all fields (names, companies, positions, cities, notes, email)." },
        "FullName": { "type": "string", "description": "Person name or part of it (fuzzy)." },
        "Position": { "type": "string", "description": "Job title words (fuzzy)." },
        "Company": { "type": "string", "description": "Organization name or part of it (fuzzy)." },
        "City": { "type": "string", "description": "City name (fuzzy)." },
        "Sector": { "type": "string", "enum": ["Ministries & Government", "Businesses & Financial Institutions", "Embassies & International Organizations", "Universities & Education", "NGOs & Civil Society", "Professional & Other Contacts"], "description": "Exact sector." },
        "dateFrom": { "type": "string", "description": "Added on or after this date (YYYY-MM-DD)." },
        "dateTo": { "type": "string", "description": "Added on or before this date (YYYY-MM-DD)." },
        "limit": { "type": "integer" }
      }
    }
  }
}
```

After the loop, `contactIds` go through the scoped `getContactsByIds`: invalid or unknown ids, and ids from another department, are dropped.

## 7. OpenRouter request reference

Endpoint: `POST {OPENROUTER_BASE_URL}/chat/completions`
Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`. Optional attribution headers: `HTTP-Referer`, `X-OpenRouter-Title`.

### 7.1 Text → JSON (`callJson`, `AI_JSON_MODE=schema`)

```json
{
  "model": "<AI_MODEL_TEXT>",
  "models": ["<AI_MODEL_TEXT>", "<fallback 1>", "<fallback 2>"],
  "max_tokens": 8000,
  "messages": [
    { "role": "system", "content": "<prompt text>" },
    { "role": "user", "content": "<text>\n…\n</text>" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": { "name": "result", "strict": true, "schema": { "…": "from toProviderSchema(schema, { strict: true })" } }
  },
  "provider": { "require_parameters": true, "data_collection": "allow" },
  "plugins": [{ "id": "response-healing" }]
}
```

- Send `models` only when `AI_FALLBACK_MODELS` is set.
- `provider.require_parameters: true` routes only to providers that support every parameter sent (here: `response_format`).
- `response-healing` repairs small JSON syntax errors on non-streaming `json_schema` requests.
- Strict schemas need `additionalProperties: false` and every property in `required`. `toProviderSchema(schema, { strict: true })` adds these and removes keywords some providers reject (`$schema`, `maxLength`, `minimum`, `maximum`, `format`, `pattern`). Zod re-checks all of them afterwards. Strict mode is for `response_format` only, never for tool parameters.
- `max_tokens` is the caller's value capped at `AI_MAX_TOKENS`.

### 7.2 `AI_JSON_MODE=prompt`

No `response_format`, no `plugins`, no `require_parameters`. `callJson` appends to the system message:

```
Reply with one JSON object only, no other text and no code fences. It must match this JSON Schema:
<schema>
```

`parseJsonLoose` then removes code fences and reads from the first `{` to the last `}`. It is used in both modes.

### 7.3 Photo (`callJson` with `image`)

Same as 7.1 with `AI_MODEL_VISION` and this user message:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Extract every business card in this photo." },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<data>" } }
  ]
}
```

### 7.4 Ask AI rounds (`runToolLoop`)

Rounds 1 and 2:

```json
{
  "model": "<AI_MODEL_TEXT>",
  "max_tokens": 8000,
  "messages": [
    { "role": "system", "content": "<search prompt>" },
    { "role": "user", "content": "Today is 2026-11-11.\nQuestion: …" }
  ],
  "tools": [ "search_contacts", "list_values", "final_answer (as in §6)" ],
  "tool_choice": "auto",
  "provider": { "require_parameters": true, "data_collection": "allow" }
}
```

The reply's `choices[0].message` may contain `tool_calls`:

```json
{ "id": "call_1", "type": "function", "function": { "name": "search_contacts", "arguments": "{\"Company\":\"Asiacell\"}" } }
```

- `arguments` is a **string**: `JSON.parse` it, then validate with the tool's Zod schema.
- Push the assistant message back unchanged, then one message per call:
  `{ "role": "tool", "tool_call_id": "call_1", "content": "<JSON result, or an error sentence>" }`.
  There is no error flag: an error is just text such as `Invalid input: dateFrom: expected YYYY-MM-DD`.
- A `final_answer` call with valid input ends the loop.
- No tool calls at all → add `{ "role": "user", "content": "Finish by calling final_answer." }`.

Round 3 (last): the same messages plus `{ "role": "user", "content": "Give the final answer now as JSON only." }`, with `tool_choice: "none"` and the `response_format` of 7.1 for the `final_answer` schema (or the 7.2 text in `prompt` mode). A `final_answer` tool call is still accepted if the model sends one.

### 7.5 Reading the response

| Field | Use |
|---|---|
| `choices[0].message.content` | The text (may be `null` when there are tool calls) |
| `choices[0].message.tool_calls` | Tool calls |
| `choices[0].finish_reason` | `stop`, `tool_calls`, `length` (cut off), `content_filter` (declined) |
| `model` | The model that really answered (differs with fallbacks or `openrouter/free`): log it |
| `usage.prompt_tokens`, `usage.completion_tokens` | Log |
| `error` (top level or in a choice) | Can come with HTTP 200: treat as a failure |

### 7.6 Errors

OpenRouter errors look like `{ "error": { "code": 429, "message": "…", "metadata": { … } } }`.

| Status | Meaning | Retry | Message shown to staff | AppError |
|---|---|---|---|---|
| 400 | Bad request, the model does not support a parameter, or `max_tokens` / the image is too large for it | No | AI request was rejected. | `AI_FAILED` |
| 401 | Bad key | No | AI service rejected the API key. | `AI_FAILED` |
| 402 | Negative balance / no credits | No | The AI account needs attention. Tell an administrator. | `AI_FAILED` |
| 403 | Input flagged | No | The AI declined to process this input. | `AI_FAILED` |
| 404 | No endpoint for this model + settings (often the privacy setting, or a removed model) | No | The AI model is not available. Tell an administrator. | `AI_FAILED` |
| 408 / timeout | Too slow | Yes | AI service timed out. | `AI_FAILED` |
| 429, per minute | Too many requests right now | Yes (wait `Retry-After`, else 2 s then 5 s) | AI service is busy. Try again in a minute. | `TOO_MANY_REQUESTS` |
| 429, per day | Daily free allowance used up | **No** | Today's free AI allowance is used up. Quick search and manual add still work. | `TOO_MANY_REQUESTS` |
| 502 / 503 | Model or provider down | Yes | AI service failed. Try again. | `AI_FAILED` |
| network error | Cannot connect | Yes | Cannot reach the AI service. | `AI_FAILED` |

At most 2 retries per request. The daily-cap 429 is recognised from the error message (it names a per-day free limit). Confirm the exact wording on the first real hit and keep it in a unit test.

### 7.7 Other endpoints

| Endpoint | Used by | For |
|---|---|---|
| `GET /models` (public, no key) | `ai:models` | Free models and abilities: `pricing.prompt` and `pricing.completion` are `"0"`; `architecture.input_modalities` contains `image`; `supported_parameters` contains `tools`, `structured_outputs`, `response_format`; `context_length` |
| `GET /key` | `ai:models`, `ai:smoke` | Whether the key works and the account's free-tier status |

`ai:models` prints a table of free models (id, context length, image input, tools, structured outputs), then for each configured model PASS / FAIL per feature it is used for.

## 8. Test tools

| Tool | What it does |
|---|---|
| `tests/mock-ai/server.mjs` | A small Node HTTP server that answers `POST /chat/completions` in the chat completions shape, for end-to-end runs with no key (`OPENROUTER_BASE_URL=http://127.0.0.1:4010`). Text: if the `<text>` equals a text fixture, returns that fixture's expected JSON. Photo: returns the first photo fixture. Ask: first a `search_contacts` call with the question as `text`, then `final_answer` with the first result id. Special inputs: `MOCK_INVALID_ONCE` (invalid JSON on the first try), `MOCK_STALL` (keeps searching, so the loop must force the final round), `MOCK_FENCED` (JSON inside code fences), `MOCK_429_DAY` (daily-cap error). Writes each request body to `requests.log` |
| Unit tests | Mock `fetch`. No network, no database |
| DB tests | `vitest` with a separate config; refuse to run unless `MONGODB_DB` contains `test` |
| `scripts/eval-score.ts` | One comparison rule for all evals (`plan.md` §10) |

## 9. Atlas Search index (`src/modules/db/search-index.json`)

Index name `contacts_search` on the `contacts` collection.

```json
{
  "analyzer": "fold",
  "searchAnalyzer": "fold",
  "analyzers": [
    {
      "name": "fold",
      "charFilters": [
        {
          "type": "mapping",
          "mappings": {
            "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي", "ـ": "",
            "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9"
          }
        }
      ],
      "tokenizer": { "type": "standard" },
      "tokenFilters": [{ "type": "icuFolding" }, { "type": "lowercase" }]
    }
  ],
  "mappings": {
    "dynamic": false,
    "fields": {
      "FullName": [
        { "type": "string", "analyzer": "fold", "multi": { "ar": { "type": "string", "analyzer": "lucene.arabic" } } },
        { "type": "autocomplete", "analyzer": "fold", "tokenization": "edgeGram", "minGrams": 2, "maxGrams": 15 }
      ],
      "Company": [
        { "type": "string", "analyzer": "fold", "multi": { "ar": { "type": "string", "analyzer": "lucene.arabic" } } },
        { "type": "autocomplete", "analyzer": "fold", "tokenization": "edgeGram", "minGrams": 2, "maxGrams": 15 }
      ],
      "Position": [
        { "type": "string", "analyzer": "fold", "multi": { "ar": { "type": "string", "analyzer": "lucene.arabic" } } },
        { "type": "autocomplete", "analyzer": "fold", "tokenization": "edgeGram", "minGrams": 2, "maxGrams": 15 }
      ],
      "City": { "type": "string", "analyzer": "fold", "multi": { "ar": { "type": "string", "analyzer": "lucene.arabic" } } },
      "Notes": { "type": "string", "analyzer": "fold", "multi": { "ar": { "type": "string", "analyzer": "lucene.arabic" } } },
      "Sector": [{ "type": "string", "analyzer": "fold" }, { "type": "token" }],
      "Email": { "type": "string", "analyzer": "fold" },
      "Mobile": { "type": "string", "analyzer": "lucene.keyword" },
      "CreatedAt": { "type": "date" },
      "DepartmentId": { "type": "objectId" }
    }
  }
}
```

- The `fold` analyzer makes أحمد, احمد and أحْمد match, and Arabic-Indic digits equal Latin digits.
- The `ar` sub-field (`lucene.arabic`) adds Arabic stemming. Query it with `path: { value: "<field>", multi: "ar" }`.
- `Sector` as `token` and `DepartmentId` as `objectId` allow exact `equals` filters; `CreatedAt` allows `range` filters.
- The department scope goes in `compound.filter` as `{ equals: { path: "DepartmentId", value: <ObjectId> } }`, in both `$search` and `$searchMeta`.

## 10. Fixture formats

**Contact JSON** (used everywhere): the 8 fields, all present.

```json
{
  "FullName": "Mustafa Kareem",
  "Position": "Business Development Manager",
  "Mobile": "+9647504451290",
  "Company": "Korek Telecom",
  "City": "Erbil",
  "Email": "mustafa.kareem@korektel.com",
  "Sector": "Businesses & Financial Institutions",
  "Notes": "Office: +964 66 222 0011; Website: www.korektel.com"
}
```

**Text fixture** `tests/fixtures/text/01-english-signature.txt` (its `.expected.json` is an array with the contact above):

```
Thanks for your time today, looking forward to the partnership.

Best regards,
Mustafa Kareem
Business Development Manager
Korek Telecom | Erbil, Kurdistan Region
M: +964 750 445 1290
T: +964 66 222 0011
mustafa.kareem@korektel.com
www.korektel.com
```

**Photo fixture**: `<name>.jpg` + `<name>.expected.json` (array of contacts in reading order). Names carry the card count, e.g. `p05-8-mixed`, `p08-12-angled-uneven`.

**Sample contacts** `tests/fixtures/sample-contacts.json`: array of 30 contacts as they would be typed (for example `"Mobile": "07701234567"` or `"٠٧٨٠١١١٢٢٣٣"`), so seeding also exercises the cleaning rules.

**Search questions** `tests/fixtures/search/questions.json`:

```json
{
  "dataset": "tests/fixtures/sample-contacts.json",
  "ask": [
    { "question": "Who is the marketing manager at Asiacell?", "expected": "Mohammed Al-Saadi" },
    { "question": "رقم أحمد الربيعي", "expected": "أحمد الربيعي" },
    { "question": "doctor in Najaf", "expected": "زينب كاظم" }
  ],
  "quick": [
    { "query": "Moh", "expected": "Mohammed Al-Saadi" },
    { "query": "Mohamad", "expected": "Mohammed Al-Saadi" },
    { "query": "احمد", "expected": "أحمد الربيعي" },
    { "query": "0770 123", "expected": "Mohammed Al-Saadi" },
    { "query": "٠٧٨٠١١١", "expected": "أحمد الربيعي" },
    { "query": "saadi@", "expected": "Mohammed Al-Saadi" }
  ]
}
```

The Ask questions must cover: a role at a company, an Arabic question, cross-script names (question in English, name stored in Arabic, and the reverse), a profession in a city, a loose category ("banks", "UN"), a sector, a typo, and a date ("added this month"). The quick queries must cover: prefix, typo, Arabic letter variants, partial mobile in Latin and Arabic-Indic digits, partial email, and a bilingual name.

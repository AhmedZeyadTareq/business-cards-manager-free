# idea.md — Business Cards Manager, OpenRouter free-model version

## 1. The idea in one paragraph

The same app as the live **Business Cards Manager** (AUIB): staff add business cards by pasting text or uploading a photo, an AI suggests contacts, a person reviews and saves them, and anyone can find a contact by typing or by asking a question in English or Arabic. The only thing that changes is **who the AI is**: instead of Claude through the Anthropic SDK (paid), this version calls a **free model through the OpenRouter API**. It lives in its own repository.

## 2. Why

- **Cost:** AI calls cost nothing, so the app can be tried, demoed or run by a small office with no AI bill.
- **Choice:** the model is an env value. Any OpenRouter model (free or paid) can be swapped in without code changes.
- **Same product:** pages, accounts, departments, roles, search, export and PWA stay exactly as they are in the live app.

## 3. What stays the same

| Area | Same as the live app |
|---|---|
| Pages | Explore, Add from Text, Add from Photo, Team, My account, admin pages (users, departments, activity) |
| Golden rule | The AI only suggests. A person reviews and presses **Save**. The AI never writes to the database. |
| Data | MongoDB Atlas, one `contacts` collection, 8 business fields, 6 sectors, `DepartmentId` scope |
| Search | Quick search (Atlas Search, no AI) + Ask AI (bounded tool loop, max 3 rounds) |
| Access | Username + password per person, roles Viewer / Editor / Admin, department scope, activity log |
| Languages | Arabic and English are equal: RTL-aware UI, Arabic-aware normalization and search |
| Code shape | Next.js 16 App Router, thin API routes, plain modules, Zod everywhere, versioned prompts, evals |
| Hosting | Local (`127.0.0.1`) or Vercel; installable PWA, online only |

## 4. What changes

| Area | Live app | This version |
|---|---|---|
| AI provider | Anthropic Messages API (`@anthropic-ai/sdk`) | OpenRouter chat completions (`https://openrouter.ai/api/v1`), plain `fetch` |
| AI module | `src/modules/claude/` | `src/modules/ai/` (same two functions: `callJson`, `runToolLoop`) |
| Model | `CLAUDE_MODEL` = one Claude model | `AI_MODEL_TEXT` (text + Ask, needs tool calling) and `AI_MODEL_VISION` (photos, needs image input); free models only unless `AI_ALLOW_PAID=true` |
| Structured output | Anthropic `output_config.format` | `response_format: json_schema` where the model supports it, otherwise schema-in-prompt; Zod validates either way |
| Tool format | Anthropic `tool_use` / `tool_result` blocks | OpenAI-style `tools`, `tool_calls`, `role: "tool"` messages |
| Reliability | Paid, stable, high limits | Free: daily request cap, slower, models come and go. Needs fallbacks and clear "try later" messages |
| Accuracy | Text 100%, photo 99.1%, search 20/20 on the fixtures | **Unknown until measured.** Expect lower, especially many-card and Arabic photos |
| Manual add | Not in the UI (the `manual` source exists but no page uses it) | **New:** an **Add manually** button on both Add pages opens an empty review block, so contacts can still be added when the free AI allowance is used up |
| Env keys | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_TIMEOUT_MS` | `OPENROUTER_API_KEY`, `AI_MODEL_TEXT`, `AI_MODEL_VISION`, `AI_FALLBACK_MODELS`, `AI_JSON_MODE`, `AI_DATA_COLLECTION`, `AI_ALLOW_PAID`, `AI_TIMEOUT_MS`, `AI_MAX_TOKENS` |

Nothing else changes: no route, database or prompt wording needs to change to start. Prompts change only if the evals say so.

## 5. Honest risks (read before building)

| Risk | Why it matters | What the plan does about it |
|---|---|---|
| **Privacy** | Free endpoints may log prompts or use them for training. Business cards hold other people's names, phones and emails. | Use **test data only** until the owner decides. `AI_DATA_COLLECTION=deny` routes only to providers that do not collect data, but many free endpoints then disappear. This is the owner's decision, not the code's. |
| **Daily cap** | Free models: about 20 requests a minute and 50 a day; 1,000 a day once the account has bought $10 of credits (one time). Ask AI uses up to 3 requests per question. | Friendly "free AI allowance used up" message; quick search, table and manual add keep working with no AI. Evals take a `--limit` and a delay. |
| **Accuracy** | Free models are smaller. Dense photos (8–12 cards) and Arabic handwriting-like fonts are the hard cases. | Model chosen by the evals, not by name. Targets stay the same; if a target is missed, report it and pick: another model, fewer cards per photo, or the "detect → crop → extract per card" upgrade. |
| **Models disappear** | Free model ids are added and removed often. | Model ids live in env only. `npm run ai:models` lists the free models that have the needed abilities today. `openrouter/free` is the last fallback. |
| **Uneven features** | Not every free model supports images, tool calling or JSON schema output. | Startup script checks the chosen models have what each feature needs. JSON falls back to schema-in-prompt + Zod + one retry. |

OpenRouter's limits and free list change. Check <https://openrouter.ai/docs> before relying on any number here.

## 6. Success criteria

1. A fresh clone runs with only an OpenRouter key and a MongoDB URI, and no payment.
2. All three AI features work end to end on a free model: text → contacts, photo → contacts, question → answer + contacts.
3. Eval numbers are measured and written in `docs/plan.md` Progress for the chosen models. Targets: text key fields ≥ 95%, photo card count ≥ 9/10 and fields ≥ 90%, Ask ≥ 90% top 3.
4. Switching model or going back to a paid model is an env change only.
5. Everything that does not use AI behaves exactly like the live app, with the same tests green.

## 7. Decisions the owner still has to make

| Decision | Options | Default in these docs |
|---|---|---|
| May real contacts be sent to free endpoints? | Yes / no / only to no-data-collection providers | **No**: test data only |
| Buy $10 of OpenRouter credits once to raise the daily cap to 1,000? | Yes / no | No (50 a day) |
| Database | Atlas M0 in the cloud / Atlas Local in Docker (fully local, test only) | Atlas M0 |
| Hosting | Local only / Vercel | Local first, Vercel when wanted |
| App name and branding | Keep AUIB branding / neutral | Keep |

## 8. Not in this version

Microsoft sign-in, Telegram / WhatsApp bots, offline use, running a model on the machine itself (Ollama and similar). The AI module is one folder, so a local-model client could replace the OpenRouter client later without touching anything else.

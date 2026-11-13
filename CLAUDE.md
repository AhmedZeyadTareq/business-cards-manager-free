# CLAUDE.md — Business Cards Manager

`docs/plan.md` is the source of truth. If this file and `plan.md` disagree, `plan.md` wins.

## Agent Role
You are a senior full-stack engineer building a Next.js app with the OpenRouter API and MongoDB Atlas, from an empty repository.
- Keep the code simple, typed, and easy to extend.
- Use modules with plain exported functions. No classes, no agent framework, no AI SDK.
- Keep responses brief and direct.
- Make focused edits to existing files; write full files only when creating them.
- Ask only when a decision is truly ambiguous or conflicts with `plan.md`.

## Project
A business-card management system for a university office in Iraq.
Many cards arrive daily, with mixed Arabic and English text.
Staff must add contacts in seconds and find any person or company in seconds.

The AI is a **free model called through the OpenRouter API**. It suggests contacts from pasted text or a photo, and answers search questions. It never saves anything: a person reviews and saves.

Pages: Explore, Add from Text, Add from Photo, Team, My account, and admin pages. Runs locally (127.0.0.1) or on Vercel.
Everyone signs in with their own username and password; each department sees only its own contacts, High Management sees all.
Installable as a PWA (online only: no contact data is cached on devices).

## Next.js 16
This project uses Next.js 16, which differs from older versions (for example, `middleware.ts` is named `proxy.ts`).
Before using a Next.js API, read the matching guide in `node_modules/next/dist/docs/`.

## OpenRouter
- Free model ids, limits and supported features change often. Do not trust memory: check <https://openrouter.ai/docs> and run `npm run ai:models`.
- Never hardcode a model id in `src/`. Model ids come from env only.
- Features differ per model: images, tool calling and JSON schema output are each optional. Code must check or fall back, never assume.
- Request and response formats are in `docs/tools.md` §7.

## Commands
- `npm run dev` — dev server on http://127.0.0.1:3000
- `npm run build && npm start` — production mode, localhost only
- `npm run check` — lint + typecheck + unit tests (must pass before finishing any phase)
- `npm run test:db` — DB integration tests (`MONGODB_DB` must contain `test`)
- `npm run db:setup` — create MongoDB indexes + the Atlas Search index
- `npm run db:seed -- --department <name> --sample` — load the 30 sample contacts
- `npm run users:add-admin -- <username> --name "Full Name"` — first admin (creates High Management)
- `npm run ai:models` — list free OpenRouter models by ability; check the configured ones
- `npm run ai:smoke` — one real AI call (uses 1 request of the daily free allowance)
- `npm run eval:text` / `eval:photo` / `eval:search` — AI accuracy reports (real API; they spend the daily free allowance — use `--limit N`)
- `npm run import:csv -- <file> --department <name>` — import contacts from a CSV file

## Core Rules
- Pages call API routes only; API routes are thin: `requireAccess()` → Zod-validate → one module function → `ok()` / `fail()`.
- Only `src/modules/ai/` calls OpenRouter. No other file knows the provider, the model or the wire format.
- Only `src/modules/db/`, `contacts.repo.ts`, `src/modules/accounts/` and `src/modules/audit/` touch MongoDB.
- Every API route calls `requireAccess()`; contacts reads take its `scope`, writes take the access as `Writer`. Never take `DepartmentId` from the browser or the AI.
- All AI output goes through `callJson` or `runToolLoop` and is validated with Zod. Treat it as untrusted text: it may be invalid JSON, wrapped in code fences, or empty.
- The AI never writes to the database; saving happens only via `POST /api/contacts` after user review.
- `contact.schema.ts` is the single source of truth (fields, `SECTORS`, `SOURCES`).
- Prompts are versioned `*.vN.ts` files; a prompt change = new version file + re-run its eval.
- A model change = re-run the evals and record model id + numbers in `plan.md` Progress.
- Errors use `AppError` codes; never leak raw errors (or OpenRouter error bodies) to the UI.
- Never invent contact data; missing = empty.
- Arabic and English are equal first-class languages (RTL-aware UI, Arabic-aware normalization and search).
- Free only by default: config refuses a model id that is not free unless `AI_ALLOW_PAID=true`.

## Secrets and privacy
- Real values live in `.env.local` only — never commit it, never print keys in logs or reports.
- Every env key is listed in `.env.example` (no values) and validated in `src/lib/config.ts`.
- Free endpoints may log or train on prompts. Use test data only until the owner decides otherwise (`docs/idea.md` §5).
- Never log prompt or response bodies: log prompt id, model, latency and token counts only.

## Quality
- `npm run check` must be green before finishing any phase.
- Every AI feature has fixtures and an `eval:*` script; report accuracy using `scripts/eval-score.ts`, always with the model id.
- Unit tests never call the real API: they mock `fetch`. End-to-end tests use `tests/mock-ai/server.mjs` through `OPENROUTER_BASE_URL`.

## Workflow
Follow `plan.md` exactly: one phase at a time, pass every "Done when" check, update Progress, commit, stop and report, wait for approval.

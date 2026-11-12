# idea.md — Business Cards Manager

## 1. The idea in one paragraph

A web app for an office that receives many business cards. Staff add contacts by **pasting text** or **uploading a photo of cards**. An AI model reads the input and **suggests** contacts. A person **reviews and corrects** them, then presses **Save**. Later, anyone in the office can **find** a contact instantly by typing, or by **asking a question** in plain English or Arabic. The AI is a **free model called through the OpenRouter API**, so the app has no AI bill.

**The golden rule:** the AI never saves anything by itself. It only suggests, and a person always approves.

## 2. Who it is for

- A university office in Iraq. Cards and messages arrive daily, in Arabic, English, or both mixed.
- Staff are not technical. They must add a contact in seconds and find any person or company in seconds, on a computer or a phone.
- Several departments use the same app. Each department sees only its own contacts. One department, **High Management**, sees everything.

## 3. What the app does

| Area | What staff can do |
|---|---|
| **Add from Text** | Paste email signatures, WhatsApp messages or notes. The AI splits them into contacts. Review, fix, save. |
| **Add from Photo** | Upload or take one photo with one or many cards. The AI returns one contact per card. Review, fix, save. |
| **Add manually** | Type a contact with no AI at all. |
| **Explore** | Quick search while typing (no AI), **Ask AI** for questions, a table with filters, view / edit / delete, CSV export, "Add to phone contacts". |
| **Accounts** | Everyone signs in with their own username and password. Roles: Viewer, Editor, Admin. Admins manage users and departments and see an activity log. |
| **Phone** | Installable as an app (PWA). Works online only; no contact data is stored on the device. |

Every contact has the same 8 fields: `FullName`, `Position`, `Mobile`, `Company`, `City`, `Email`, `Sector`, `Notes`.

## 4. Principles

1. **A person approves every save.** AI output goes to a review screen, never to the database.
2. **Never invent data.** A missing value stays empty.
3. **Arabic and English are equal.** Right-to-left text displays correctly, and search treats أحمد and احمد as the same.
4. **AI output is untrusted text.** It is checked against a schema before anyone sees it.
5. **The app is useful without AI.** Quick search, the table, edit, delete, export and manual add never call the AI.
6. **Departments are isolated by the server.** No request can read another department's contacts, including through search, Ask AI, export or a direct link.
7. **Simple code.** Small modules with plain functions. One folder talks to the AI, one talks to the database.

## 5. Why free models through OpenRouter

- **Cost:** free models cost nothing, so a small office can run the app with no AI budget.
- **Choice:** OpenRouter gives one API for many models. The model is an env value, so it can be changed without code changes, including to a paid model later.

### What this choice costs (read before building)

| Risk | Why it matters | What the plan does about it |
|---|---|---|
| **Privacy** | Free endpoints may log prompts or use them for training. Business cards hold other people's names, phones and emails. | **Test data only** until the owner decides. An env setting can restrict requests to providers that do not collect data, but many free endpoints then disappear. |
| **Daily cap** | Free models allow about 20 requests a minute and 50 a day; 1,000 a day once the account has bought $10 of credits (one time). Ask AI uses up to 3 requests per question. | A clear "today's free AI allowance is used up" message. Everything that needs no AI keeps working, including manual add. |
| **Accuracy** | Free models are small. Photos with many cards and Arabic text are the hard cases. | The model is chosen by measured accuracy (evals), not by name. If a target is missed, it is reported and the owner decides. |
| **Models disappear** | Free model ids are added and removed often. | Model ids live in env only. A script lists the free models that have the needed abilities today. |
| **Uneven features** | Not every free model supports images, tool calling or JSON schema output. | A script checks the chosen models. JSON output has a fallback mode. |

OpenRouter's limits and free model list change. Check <https://openrouter.ai/docs> before relying on any number in these docs.

## 6. Success criteria

1. A fresh clone runs with only an OpenRouter key and a MongoDB connection string, and no payment.
2. All three AI features work end to end on a free model: text → contacts, photo → contacts, question → answer + contacts.
3. Accuracy is measured and written in `plan.md` Progress with the model id. Targets: text key fields ≥ 95%; photo card count right on ≥ 9 of 10 photos and fields ≥ 90%; Ask AI finds the right contact in the top 3 for ≥ 90% of questions.
4. Quick search answers in under 300 ms and the table stays fast with 12,000 contacts.
5. A department user can never see another department's contact. This is proven by tests.
6. Changing the model is an env change only.

## 7. Decisions the owner still has to make

| Decision | Options | Default in these docs |
|---|---|---|
| May real contacts be sent to free endpoints? | Yes / no / only to providers that do not collect data | **No**: test data only |
| Buy $10 of OpenRouter credits once to raise the daily cap to 1,000? | Yes / no | No (50 a day) |
| Database | MongoDB Atlas free tier in the cloud / Atlas Local in Docker | Atlas free tier |
| Hosting | One local computer / Vercel | Local first |
| Branding | Organization name, logo, colours, the people on the Team page | App name "Business Cards Manager", crimson theme, placeholder logo |

## 8. Not in this version

Microsoft or Google sign-in, Telegram or WhatsApp bots, offline use, running a model on the machine itself, moving contacts between departments, sharing one contact with several departments.

## 9. How to read these docs

| File | Read it for |
|---|---|
| `idea.md` | What is being built and why (this file) |
| `plan.md` | The full specification and the build phases. **Source of truth.** |
| `tools.md` | Env keys, commands, the OpenRouter request formats, the search index, test fixtures |
| `instructions.md` | Accounts to create, how to run, how to choose models, troubleshooting |
| `claude.md` | Rules for the coding agent that builds the app |

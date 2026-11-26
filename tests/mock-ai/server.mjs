// A fake OpenRouter chat completions API, for trying the pages in a browser with no key
// and without spending free requests:
//
//   node tests/mock-ai/server.mjs            (port 4010, or PORT=…)
//   .env.local: OPENROUTER_BASE_URL=http://127.0.0.1:4010
//
// Text: a <text> equal to a text fixture returns that fixture's expected contacts; any
// other text returns an empty list. Photo: the first photo fixture. Ask: first a
// search_contacts call with the question as `text`, then final_answer with the first
// result id. Special inputs (anywhere in the text or question):
//   MOCK_INVALID_ONCE  invalid JSON on the first try, valid on the retry
//   MOCK_STALL         keeps searching, so the loop must force the final round
//   MOCK_FENCED        the JSON inside code fences
//   MOCK_429_DAY       the daily-cap error
// Each request body is written to tests/mock-ai/requests.log (git-ignored; test data only).
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures");
const logFile = join(here, "requests.log");
const port = Number(process.env.PORT ?? 4010);

const normalize = (text) => text.replace(/\r\n/g, "\n").trim();

function loadTextFixtures() {
  const dir = join(fixtures, "text");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => ({
      text: normalize(readFileSync(join(dir, name), "utf8")),
      contacts: JSON.parse(
        readFileSync(join(dir, name.replace(/\.txt$/, ".expected.json")), "utf8"),
      ),
    }));
}

function firstPhotoFixture() {
  const dir = join(fixtures, "photos");
  if (!existsSync(dir)) return [];
  const name = readdirSync(dir)
    .filter((file) => file.endsWith(".expected.json"))
    .sort()[0];
  return name ? JSON.parse(readFileSync(join(dir, name), "utf8")) : [];
}

const textFixtures = loadTextFixtures();

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return "";
}

const hasImage = (messages) =>
  messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"),
  );

function reply(message, finishReason = "stop") {
  return {
    id: "mock",
    model: "mock/model:free",
    choices: [
      { index: 0, finish_reason: finishReason, message: { role: "assistant", ...message } },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

const toolCall = (name, args, id) =>
  reply(
    {
      content: null,
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    "tool_calls",
  );

function jsonReply(value, all) {
  const json = JSON.stringify(value);
  return reply({ content: all.includes("MOCK_FENCED") ? `\`\`\`json\n${json}\n\`\`\`` : json });
}

function answerAsk(body, all) {
  const messages = body.messages;
  const question = /Question:\s*([\s\S]*)/.exec(textOf(messages[1]?.content))?.[1]?.trim() ?? "";
  const toolResults = messages.filter((message) => message.role === "tool");
  let firstId;
  for (const result of toolResults) {
    try {
      firstId ??= JSON.parse(result.content).results?.[0]?.id;
    } catch {
      // An error sentence, not JSON.
    }
  }
  const final = {
    answer: firstId ? "Here is the best match." : "No matching contact was found.",
    contactIds: firstId ? [firstId] : [],
  };
  if (body.tool_choice === "none") return jsonReply(final, all);
  if (all.includes("MOCK_STALL") || toolResults.length === 0) {
    const text = question.replace(/MOCK_\w+/g, "").trim();
    return toolCall("search_contacts", { text }, `call_${toolResults.length + 1}`);
  }
  return toolCall("final_answer", final, "call_final");
}

function answer(body) {
  const messages = body.messages ?? [];
  const all = messages.map((message) => textOf(message.content)).join("\n");

  if (all.includes("MOCK_429_DAY")) {
    return {
      status: 429,
      body: {
        error: {
          code: 429,
          message:
            "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
        },
      },
    };
  }
  if (body.tools?.length) return { status: 200, body: answerAsk(body, all) };

  const retried = messages.some((message) => message.role === "assistant");
  if (all.includes("MOCK_INVALID_ONCE") && !retried) {
    return { status: 200, body: reply({ content: "Sorry, here you go: {contacts: [oops" }) };
  }
  if (hasImage(messages)) {
    const contacts = firstPhotoFixture();
    return { status: 200, body: jsonReply({ cardCount: contacts.length, contacts }, all) };
  }
  const user = textOf(messages.find((message) => message.role === "user")?.content);
  const text = normalize(
    (/<text>\n?([\s\S]*?)\n?<\/text>/.exec(user)?.[1] ?? "").replace(/MOCK_\w+/g, ""),
  );
  const fixture = textFixtures.find((candidate) => candidate.text === text);
  return { status: 200, body: jsonReply({ contacts: fixture?.contacts ?? [] }, all) };
}

createServer((request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
    return send(404, { error: { code: 404, message: "mock: only POST /chat/completions" } });
  }
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    try {
      const body = JSON.parse(raw);
      // Image data would fill the log: keep only its size.
      const logged = JSON.stringify(body, (key, value) =>
        key === "url" && typeof value === "string" && value.startsWith("data:")
          ? `data:(${value.length} chars)`
          : value,
      );
      appendFileSync(logFile, `${logged}\n`);
      const result = answer(body);
      send(result.status, result.body);
    } catch (error) {
      send(400, { error: { code: 400, message: `mock: ${error.message}` } });
    }
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Mock AI on http://127.0.0.1:${port} (${textFixtures.length} text fixtures)`);
});

// npm run ai:smoke            one real call through callJson (1 free request)
// npm run ai:smoke -- --tools one real runToolLoop with a stub tool (up to 2 more)
import { readFileSync } from "node:fs";
import { z } from "zod";
import { config } from "@/lib/config";
import { callJson } from "@/modules/ai/call-json";
import { defineTool, runToolLoop } from "@/modules/ai/tool-loop";
import { AiContact } from "@/modules/contacts/contact.schema";
import { cleanContact } from "@/modules/contacts/normalize";

async function smokeJson() {
  const result = await callJson({
    prompt: {
      id: "smoke.v1",
      text:
        "Extract the business contact from the text. Fields: FullName, Position, Mobile, Company, City, Email, " +
        'Sector (one of: "Ministries & Government", "Businesses & Financial Institutions", ' +
        '"Embassies & International Organizations", "Universities & Education", "NGOs & Civil Society", ' +
        '"Professional & Other Contacts"), Notes. A field with no information is "".',
    },
    // The first text fixture (test data), so the mock AI server can answer it too.
    input: `<text>\n${readFileSync("tests/fixtures/text/01-english-signature.txt", "utf8").trim()}\n</text>`,
    schema: z.object({ contacts: z.array(AiContact) }),
    maxTokens: 2000,
  });
  const contact = result.contacts[0];
  if (!contact) throw new Error("The model returned no contact.");
  console.log("Validated contact:", cleanContact(contact));
}

async function smokeTools() {
  let called = 0;
  const { result, rounds, calls } = await runToolLoop({
    prompt: {
      id: "smoke-tools.v1",
      text: "You answer questions about a small phone book. Use lookup_person to find people, then call final_answer.",
    },
    userText: "Question: What is the phone number of Ali?",
    tools: [
      defineTool({
        name: "lookup_person",
        description: "Look up a person by name. Returns matching people with their id and phone.",
        schema: z.object({ name: z.string().describe("Name or part of it.") }),
        run: async () => {
          called++;
          return { count: 1, results: [{ id: "p1", name: "Ali Hassan", phone: "+9647701112233" }] };
        },
      }),
    ],
    final: {
      name: "final_answer",
      description:
        "Give the final answer and the ids of the matching people. Always end with this.",
      schema: z.object({ answer: z.string(), contactIds: z.array(z.string()) }),
    },
  });
  console.log(`Tool loop finished in ${rounds} round(s); the stub tool ran ${called} time(s).`);
  console.log("Calls:", calls);
  console.log("Result:", result);
  if (called === 0) {
    throw new Error("The model answered without calling the tool: tool calling is NOT proven.");
  }
}

async function main() {
  const env = config();
  const tools = process.argv.includes("--tools");
  console.log(
    `Model: ${env.AI_MODEL_TEXT} · JSON mode: ${env.AI_JSON_MODE} · ${env.OPENROUTER_BASE_URL}`,
  );
  await (tools ? smokeTools() : smokeJson());
  console.log("OK");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});

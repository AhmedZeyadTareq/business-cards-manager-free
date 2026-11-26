import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfig } from "@/lib/config";
import { authorize } from "@/modules/accounts/access";
import { AI_LIMIT_MESSAGE, spendAiUse } from "@/modules/accounts/ai-usage";
import { insertContacts, quickSearch } from "@/modules/contacts/contacts.repo";
import type { Contact, ReviewContact } from "@/modules/contacts/contact.schema";
import { collections } from "@/modules/db/mongo";
import { structureText } from "@/modules/extraction/structure-text";
import { ask } from "@/modules/search/ask";
import { POST as askRoute } from "@/app/api/ask/route";
import { POST as extractTextRoute } from "@/app/api/extract/text/route";
import { POST as extractPhotoRoute } from "@/app/api/extract/photo/route";
import { POST as saveRoute } from "@/app/api/contacts/route";
import {
  contact,
  jsonRequest,
  makeUser,
  makeWorld,
  read,
  signInAs,
  tokenFor,
  waitFor,
  type World,
} from "./helpers";

// The AI is mocked (fetch); MongoDB is real.

let world: World;
let inA: Contact[];
let inB: Contact[];

type Reply = { status?: number; body: unknown };
function mockAi(replies: Reply[]) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      const reply = replies.shift();
      if (!reply) throw new Error("mockAi: no reply left");
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
  return sent;
}
const content = (value: unknown): Reply => ({
  body: {
    model: "mock:free",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
  },
});
const toolCalls = (calls: { name: string; args: unknown }[]): Reply => ({
  body: {
    model: "mock:free",
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: calls.map((call, index) => ({
            id: `c${index}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        },
      },
    ],
  },
});
const DAILY: Reply = {
  status: 429,
  body: { error: { code: 429, message: "Rate limit exceeded: free-models-per-day" } },
};

const ai = (fields: Record<string, string>) => ({
  FullName: "",
  Position: "",
  Mobile: "",
  Company: "",
  City: "",
  Email: "",
  Sector: "Professional & Other Contacts",
  Notes: "",
  ...fields,
});

function setLimit(limit: string) {
  process.env.AI_USER_DAILY_LIMIT = limit;
  resetConfig();
}

beforeAll(async () => {
  world = await makeWorld();
  inA = await insertContacts(
    world.users.aEditor,
    [
      contact({
        FullName: "Mustafa Kareem",
        Company: "Korek Telecom",
        Mobile: "07504451290",
        Email: "mustafa@korek.test",
      }),
    ],
    "manual",
  );
  inB = await insertContacts(
    world.users.bEditor,
    [
      contact({
        FullName: "Secret Person",
        Company: "Beta Secret Holdings",
        Mobile: "07802220002",
      }),
    ],
    "manual",
  );
  await waitFor(
    () => quickSearch({ kind: "all" }, "Secret"),
    (found) => found.total >= 1,
  );
  await waitFor(
    () => quickSearch({ kind: "all" }, "Mustafa"),
    (found) => found.total >= 1,
  );
}, 300_000);

afterEach(() => {
  vi.unstubAllGlobals();
  setLimit("15");
});

describe("Add from Text", () => {
  const TEXT = "Mustafa Kareem, Korek Telecom, M: +964 750 445 1290";

  it("re-submitting a saved contact's text flags it as a duplicate (own department only)", async () => {
    const reply = () =>
      content({
        contacts: [
          ai({ FullName: "Mustafa Kareem", Company: "Korek Telecom", Mobile: "+964 750 445 1290" }),
        ],
      });
    const sent = mockAi([reply(), reply()]);
    const asA = await structureText(world.a._id, TEXT);
    expect(asA.contacts[0]).toMatchObject({
      Mobile: "+9647504451290",
      duplicateOfId: inA[0].id,
      duplicateOfName: "Mustafa Kareem",
    });
    const asB = await structureText(world.b._id, TEXT);
    expect(asB.contacts[0].duplicateOfId).toBeUndefined();
    expect((sent[0].messages as { content: string }[])[1].content).toBe(`<text>\n${TEXT}\n</text>`);
  });

  it("the same person twice in one text flags the in-batch duplicate; empty contacts are dropped", async () => {
    mockAi([
      content({
        contacts: [
          ai({ FullName: "New Person", Mobile: "0771 000 1111" }),
          ai({}),
          ai({ FullName: "New Person again", Mobile: "07710001111", Email: "Bad@" }),
        ],
      }),
    ]);
    const { contacts } = await structureText(world.a._id, "two people");
    expect(contacts).toHaveLength(2);
    expect(contacts[0].duplicateInBatch).toBeUndefined();
    expect(contacts[1].duplicateInBatch).toBe(0);
    // An invalid email is kept for the review list, where it shows in red…
    expect(contacts[1].Email).toBe("bad@");
  });

  it("…and an invalid email blocks the save", async () => {
    signInAs(world.users.aEditor);
    const { status, body } = await read(
      await saveRoute(
        jsonRequest("/api/contacts", "POST", {
          source: "text",
          contacts: [{ FullName: "New Person", Email: "bad@" }],
        }),
      ),
    );
    expect(status).toBe(400);
    expect(body.error.message).toBe("Not a valid email: bad@. Fix it or clear the field.");
    expect(await collections().contacts.countDocuments({ FullName: "New Person" })).toBe(0);
  });

  it("validates the input before any AI call", async () => {
    const sent = mockAi([]);
    await expect(structureText(world.a._id, "   ")).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Paste some text first.",
    });
    await expect(structureText(world.a._id, "x".repeat(20_001))).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(sent).toHaveLength(0);
  });

  it("a daily-cap error shows the friendly message and the manual path still saves", async () => {
    mockAi([DAILY]);
    signInAs(world.users.aEditor);
    const failed = await read(
      await extractTextRoute(jsonRequest("/api/extract/text", "POST", { text: "anything" })),
    );
    expect(failed.status).toBe(429);
    expect(failed.body.error.message).toBe(
      "Today's free AI allowance is used up. Quick search and manual add still work.",
    );
    const saved = await read<Contact[]>(
      await saveRoute(
        jsonRequest("/api/contacts", "POST", {
          source: "manual",
          contacts: [{ FullName: "Typed By Hand", Mobile: "07712223333" }],
        }),
      ),
    );
    expect(saved.status).toBe(201);
    expect(saved.body.data[0]).toMatchObject({ Source: "manual", Mobile: "+9647712223333" });
  });

  it("viewers cannot use the AI add routes, and are not charged an AI use", async () => {
    const sent = mockAi([]);
    signInAs(world.users.aViewer);
    expect(
      (await extractTextRoute(jsonRequest("/api/extract/text", "POST", { text: "x" }))).status,
    ).toBe(403);
    const form = new FormData();
    form.set("image", new File([new Uint8Array(20)], "x.jpg"));
    expect(
      (
        await extractPhotoRoute(
          new Request("http://localhost/api/extract/photo", { method: "POST", body: form }),
        )
      ).status,
    ).toBe(403);
    expect(sent).toHaveLength(0);
    const used = await collections().aiUsage.countDocuments({
      _id: { $regex: `^${world.users.aViewer.user._id.toHexString()}` },
    });
    expect(used).toBe(0);
  });

  it("the photo route refuses a file that is not an image", async () => {
    const sent = mockAi([]);
    signInAs(world.users.aEditor);
    const form = new FormData();
    form.set(
      "image",
      new File(["just some text, renamed to .jpg"], "fake.jpg", { type: "image/jpeg" }),
    );
    const { status, body } = await read(
      await extractPhotoRoute(
        new Request("http://localhost/api/extract/photo", { method: "POST", body: form }),
      ),
    );
    expect(status).toBe(415);
    expect(body.error.message).toBe("Unsupported image. Use JPG, PNG, WEBP or HEIC.");
    const empty = await read(
      await extractPhotoRoute(
        new Request("http://localhost/api/extract/photo", { method: "POST", body: new FormData() }),
      ),
    );
    expect(empty.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("the per-user daily AI limit", () => {
  it("stops one person at the limit while another can still use the AI", async () => {
    setLimit("2");
    const first = await makeUser(world.a, "editor", "heavy");
    const second = await makeUser(world.a, "editor", "light");
    await expect(authorize(tokenFor(first), "add", { ai: true })).resolves.toBeTruthy();
    await expect(authorize(tokenFor(first), "add", { ai: true })).resolves.toBeTruthy();
    await expect(authorize(tokenFor(first), "add", { ai: true })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: AI_LIMIT_MESSAGE,
    });
    await expect(authorize(tokenFor(second), "add", { ai: true })).resolves.toBeTruthy();
    // Requests that are not AI actions are never limited.
    await expect(authorize(tokenFor(first), "add")).resolves.toBeTruthy();
  });

  it("the count starts again the next day (app time zone)", async () => {
    setLimit("1");
    const person = await makeUser(world.a, "editor", "daily");
    const id = person.user._id;
    // 23:30 and 00:30 Baghdad time (UTC+3) are different days.
    const lateEvening = new Date("2026-11-02T20:30:00Z");
    const afterMidnight = new Date("2026-11-02T21:30:00Z");
    await spendAiUse(id, lateEvening);
    await expect(spendAiUse(id, lateEvening)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(spendAiUse(id, afterMidnight)).resolves.toBeUndefined();
    const days = await collections()
      .aiUsage.find({ _id: { $regex: `^${id.toHexString()}` } })
      .toArray();
    expect(days.map((day) => day._id.split("|")[1]).sort()).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("a use is counted even when the AI call then fails, and the route shows the per-user message", async () => {
    setLimit("1");
    const person = await makeUser(world.a, "editor", "unlucky");
    signInAs(person);
    mockAi([DAILY]);
    expect(
      (await extractTextRoute(jsonRequest("/api/extract/text", "POST", { text: "anything" })))
        .status,
    ).toBe(429);
    const sent = mockAi([]);
    const second = await read(
      await askRoute(jsonRequest("/api/ask", "POST", { question: "who?" })),
    );
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe(
      "You have used your AI allowance for today. Quick search and manual add still work.",
    );
    expect(sent).toHaveLength(0);
  });

  it("0 switches the limit off", async () => {
    setLimit("0");
    const person = await makeUser(world.a, "viewer", "unlimited");
    for (let i = 0; i < 5; i++) await spendAiUse(person.user._id);
    expect(
      await collections().aiUsage.countDocuments({
        _id: { $regex: `^${person.user._id.toHexString()}` },
      }),
    ).toBe(0);
  });
});

describe("Ask AI", () => {
  it("as department A never returns a contact of department B, even when the AI names B's ids", async () => {
    const sent = mockAi([
      toolCalls([
        { name: "search_contacts", args: { text: "Secret" } },
        {
          name: "search_contacts",
          args: { Company: "Beta Secret Holdings", DepartmentId: world.b._id.toHexString() },
        },
        { name: "list_values", args: { field: "Company" } },
      ]),
      toolCalls([
        {
          name: "final_answer",
          args: { answer: "Found them.", contactIds: [inB[0].id, inA[0].id, "junk"] },
        },
      ]),
    ]);
    const result = await ask(
      world.users.aEditor.scope,
      "Who works at Beta Secret Holdings?",
      new Date("2026-11-11T09:00:00Z"),
    );
    expect(result.contacts.map((item) => item.id)).toEqual([inA[0].id]);
    expect(result.rounds).toBe(2);

    // What the tools told the model: nothing from department B.
    const toolMessages = (sent[1].messages as { role: string; content: string }[]).filter(
      (message) => message.role === "tool",
    );
    expect(toolMessages).toHaveLength(3);
    for (const message of toolMessages) {
      expect(message.content).not.toContain("Secret Person");
      expect(message.content).not.toContain("Beta Secret");
      expect(message.content).not.toContain(inB[0].id);
    }
    expect(JSON.parse(toolMessages[0].content)).toEqual({ count: 0, results: [] });
    expect(JSON.parse(toolMessages[2].content).values).toContain("Korek Telecom (1)");
    expect((sent[0].messages as { content: string }[])[1].content).toBe(
      "Today is 2026-11-11.\nQuestion: Who works at Beta Secret Holdings?",
    );
  });

  it("High Management gets the contact; results carry the Added day", async () => {
    const sent = mockAi([
      toolCalls([{ name: "search_contacts", args: { text: "Secret", FullName: "", City: null } }]),
      toolCalls([
        { name: "final_answer", args: { answer: "One match.", contactIds: [inB[0].id] } },
      ]),
    ]);
    const result = await ask(world.users.admin.scope, "Secret?");
    expect(result.contacts.map((item) => item.FullName)).toEqual(["Secret Person"]);
    const toolMessage = (sent[1].messages as { role: string; content: string }[]).find(
      (message) => message.role === "tool",
    )!;
    const output = JSON.parse(toolMessage.content);
    expect(output.count).toBe(1);
    expect(output.results[0]).toMatchObject({ id: inB[0].id, FullName: "Secret Person" });
    expect(output.results[0].Added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(output.results[0]).not.toHaveProperty("Notes");
  });

  it("validates the question before any AI call and the route answers for viewers too", async () => {
    const sent = mockAi([]);
    await expect(ask(world.users.aEditor.scope, "  ")).rejects.toMatchObject({
      message: "Type a question first.",
    });
    await expect(ask(world.users.aEditor.scope, "x".repeat(501))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(sent).toHaveLength(0);

    mockAi([toolCalls([{ name: "final_answer", args: { answer: "Nobody.", contactIds: [] } }])]);
    signInAs(world.users.aViewer);
    const { status, body } = await read<{
      answer: string;
      contacts: ReviewContact[];
      rounds: number;
    }>(await askRoute(jsonRequest("/api/ask", "POST", { question: "anyone?" })));
    expect(status).toBe(200);
    expect(body.data).toEqual({ answer: "Nobody.", contacts: [], rounds: 1 });
  });
});

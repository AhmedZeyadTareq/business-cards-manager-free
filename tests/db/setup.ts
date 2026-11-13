import { afterAll, vi } from "vitest";

// DB integration tests run against a real MongoDB with Atlas Search (Atlas Local in
// Docker, or a test database on Atlas). They refuse to touch a non-test database.
const name = process.env.MONGODB_DB ?? "";
if (!name.includes("test")) {
  throw new Error(`DB tests refuse to run: MONGODB_DB ("${name}") must contain "test".`);
}
if (!process.env.MONGODB_URI) throw new Error("DB tests need MONGODB_URI.");

// The route handlers read the session cookie through next/headers. Tests put the
// cookie in this jar instead of a browser.
const jar = new Map<string, string>();
(globalThis as Record<string, unknown>).__testCookies = jar;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { name: key, value: jar.get(key) } : undefined),
    set: (key: string, value: string) => void jar.set(key, value),
    delete: (key: string) => void jar.delete(key),
  }),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));

afterAll(async () => {
  const { closeDb } = await import("@/modules/db/mongo");
  await closeDb();
});

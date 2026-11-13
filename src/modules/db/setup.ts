import { collections, getDb } from "./mongo";
import searchIndex from "./search-index.json";

export const SEARCH_INDEX = "contacts_search";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SearchIndexInfo = { name: string; status?: string; queryable?: boolean };

/** Creates the Atlas Search index, or updates it, then waits until it is READY and queryable. */
async function ensureSearchIndex(log: (line: string) => void): Promise<void> {
  const { contacts } = collections();
  const find = async () =>
    (await contacts.listSearchIndexes(SEARCH_INDEX).toArray()) as SearchIndexInfo[];

  const existing = (await find())[0];
  if (!existing) {
    await contacts.createSearchIndex({ name: SEARCH_INDEX, definition: searchIndex });
    log(`Search index ${SEARCH_INDEX}: created`);
  } else {
    await contacts.updateSearchIndex(SEARCH_INDEX, searchIndex);
    log(`Search index ${SEARCH_INDEX}: updated`);
    await sleep(2000);
  }

  const until = Date.now() + 4 * 60_000;
  while (Date.now() < until) {
    const info = (await find())[0];
    if (info?.status === "READY" && info.queryable) {
      log(`Search index ${SEARCH_INDEX}: READY`);
      return;
    }
    if (info?.status === "FAILED") throw new Error(`Search index ${SEARCH_INDEX} failed to build`);
    await sleep(2000);
  }
  throw new Error(`Search index ${SEARCH_INDEX} was not ready after 4 minutes`);
}

/** Indexes + the Atlas Search index. Safe to re-run. */
export async function setupDatabase(log: (line: string) => void = () => {}): Promise<void> {
  const db = getDb();
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  for (const name of [
    "contacts",
    "departments",
    "users",
    "login_attempts",
    "ai_usage",
    "audit_log",
  ]) {
    if (!names.includes(name)) await db.createCollection(name);
  }

  const { contacts, departments, users, loginAttempts, aiUsage, audit } = collections();
  await contacts.createIndexes([
    { key: { City: 1 } },
    { key: { Sector: 1 } },
    { key: { Company: 1 } },
    { key: { CreatedAt: -1 } },
    { key: { DepartmentId: 1, CreatedAt: -1 } },
    { key: { _emails: 1 } },
    { key: { _mobiles: 1 } },
  ]);
  await departments.createIndex(
    { name: 1 },
    { unique: true, collation: { locale: "en", strength: 2 } },
  );
  await users.createIndex({ username: 1 }, { unique: true });
  await audit.createIndex({ at: -1 });
  await loginAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await aiUsage.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  log("Indexes: ok");

  await ensureSearchIndex(log);
}

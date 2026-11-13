import { ObjectId } from "mongodb";
import type { Role } from "@/modules/accounts/account.schema";
import { accessFor, type Access } from "@/modules/accounts/access";
import { createDepartment, ensureHighManagement } from "@/modules/accounts/departments.repo";
import { createSessionToken, SESSION_COOKIE } from "@/modules/accounts/session";
import { createUser, findUserById } from "@/modules/accounts/users.repo";
import { emptyContact, type ContactInput } from "@/modules/contacts/contact.schema";
import { collections, getDb, type DepartmentDoc } from "@/modules/db/mongo";
import { setupDatabase } from "@/modules/db/setup";

export const PASSWORD = "correct-horse-battery";

export const jar = (globalThis as unknown as { __testCookies: Map<string, string> }).__testCookies;

/** Empties every collection (the search index stays). */
export async function resetDatabase(): Promise<void> {
  await setupDatabase();
  const c = collections();
  await Promise.all([
    c.contacts.deleteMany({}),
    c.users.deleteMany({}),
    c.departments.deleteMany({}),
    c.loginAttempts.deleteMany({}),
    c.aiUsage.deleteMany({}),
    c.audit.deleteMany({}),
  ]);
  if (!getDb().databaseName.includes("test")) throw new Error("not a test database");
}

export type World = {
  hm: DepartmentDoc;
  a: DepartmentDoc;
  b: DepartmentDoc;
  users: Record<string, Access>;
};

let counter = 0;

export async function makeUser(department: DepartmentDoc, role: Role, label?: string) {
  const username = `${label ?? role}.${++counter}`;
  const user = await createUser({
    username,
    name: `Test ${username}`,
    password: PASSWORD,
    departmentId: department._id.toHexString(),
    role,
  });
  const doc = (await findUserById(user.id))!;
  return accessFor(doc, department);
}

/** High Management + departments A and B, with people in each role. */
export async function makeWorld(): Promise<World> {
  await resetDatabase();
  const hm = await ensureHighManagement();
  const { departments } = collections();
  const a = (await departments.findOne({
    _id: new ObjectId((await createDepartment("Dept A")).id),
  }))!;
  const b = (await departments.findOne({
    _id: new ObjectId((await createDepartment("Dept B")).id),
  }))!;
  const users = {
    admin: await makeUser(hm, "admin"),
    hmEditor: await makeUser(hm, "editor", "hm-editor"),
    hmViewer: await makeUser(hm, "viewer", "hm-viewer"),
    aEditor: await makeUser(a, "editor", "a-editor"),
    aViewer: await makeUser(a, "viewer", "a-viewer"),
    bEditor: await makeUser(b, "editor", "b-editor"),
  };
  return { hm, a, b, users };
}

export function contact(fields: Partial<ContactInput>): ContactInput {
  return { ...emptyContact(), ...fields };
}

export function tokenFor(access: Access): string {
  return createSessionToken(access.user._id.toHexString(), access.user.sessionVersion);
}

/** Makes the next route-handler calls come from this person (or from nobody). */
export function signInAs(access: Access | null): void {
  jar.clear();
  if (access) jar.set(SESSION_COOKIE, tokenFor(access));
}

export function jsonRequest(url: string, method: string, body?: unknown, headers?: HeadersInit) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type ApiBody<T> = { ok: boolean; data: T; error: { code: string; message: string } };

export async function read<T = Record<string, unknown>>(
  response: Response,
): Promise<{ status: number; body: ApiBody<T> }> {
  return { status: response.status, body: (await response.json()) as ApiBody<T> };
}

export const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});

/** Atlas Search indexes new documents a moment after the write: wait until they show. */
export async function waitFor<T>(
  run: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await run();
    if (done(value) || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

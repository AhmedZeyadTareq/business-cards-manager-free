import { MongoClient, type Collection, type Db, type ObjectId } from "mongodb";
import { config } from "@/lib/config";
import type { ContactInput, Source } from "@/modules/contacts/contact.schema";
import type { Role } from "@/modules/accounts/account.schema";

export type ContactDoc = ContactInput & {
  _id: ObjectId;
  Source: Source;
  DepartmentId?: ObjectId | null;
  CreatedBy: ObjectId | null;
  UpdatedBy: ObjectId | null;
  _mobiles: string[];
  _emails: string[];
  CreatedAt: Date;
  UpdatedAt: Date;
};

export type DepartmentDoc = {
  _id: ObjectId;
  name: string;
  isHighManagement: boolean;
  active: boolean;
  createdAt: Date;
};

export type UserDoc = {
  _id: ObjectId;
  username: string;
  name: string;
  passwordHash: string;
  departmentId: ObjectId;
  role: Role;
  active: boolean;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type LoginAttemptDoc = { _id: string; username: string; count: number; expiresAt: Date };
export type AiUsageDoc = { _id: string; count: number; expiresAt: Date };

export type AuditAction = "create" | "update" | "delete" | "export";
export type AuditDoc = {
  _id: ObjectId;
  at: Date;
  userId: ObjectId | null;
  username: string;
  action: AuditAction;
  contactId?: ObjectId;
  contactName?: string;
  departmentId?: ObjectId | null;
  before?: Record<string, unknown>;
  count?: number;
  detail?: string;
};

// One cached client on globalThis: safe for dev hot reload and serverless reuse.
const store = globalThis as typeof globalThis & { __cardsMongo?: MongoClient };
let databaseName: string | undefined;

export function getClient(): MongoClient {
  store.__cardsMongo ??= new MongoClient(config().MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 10,
  });
  return store.__cardsMongo;
}

/** Only `eval:search` switches database (to EVAL_DB). */
export function switchDatabase(name: string): void {
  databaseName = name;
}

export function currentDatabaseName(): string {
  return databaseName ?? config().MONGODB_DB;
}

export function getDb(): Db {
  return getClient().db(currentDatabaseName());
}

export function collections(): {
  contacts: Collection<ContactDoc>;
  departments: Collection<DepartmentDoc>;
  users: Collection<UserDoc>;
  loginAttempts: Collection<LoginAttemptDoc>;
  aiUsage: Collection<AiUsageDoc>;
  audit: Collection<AuditDoc>;
} {
  const db = getDb();
  return {
    contacts: db.collection<ContactDoc>("contacts"),
    departments: db.collection<DepartmentDoc>("departments"),
    users: db.collection<UserDoc>("users"),
    loginAttempts: db.collection<LoginAttemptDoc>("login_attempts"),
    aiUsage: db.collection<AiUsageDoc>("ai_usage"),
    audit: db.collection<AuditDoc>("audit_log"),
  };
}

export async function closeDb(): Promise<void> {
  const client = store.__cardsMongo;
  store.__cardsMongo = undefined;
  if (client) await client.close();
}

/** For scripts: run, then close the connection so the process can end. */
export async function withDb<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    await closeDb();
  }
}

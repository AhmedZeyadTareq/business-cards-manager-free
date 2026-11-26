import { ObjectId } from "mongodb";
import type { AuditItem } from "@/modules/accounts/account.schema";
import { collections, type AuditDoc } from "@/modules/db/mongo";

export type AuditEntry = Omit<AuditDoc, "_id" | "at">;

export async function writeAudit(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const at = new Date();
  await collections().audit.insertMany(
    entries.map((entry) => ({ _id: new ObjectId(), at, ...entry })),
  );
}

/** Newest first. Never returns `before`. */
export async function listAudit(query: {
  page: number;
  pageSize: number;
}): Promise<{ items: AuditItem[]; total: number }> {
  const { audit } = collections();
  const [docs, total] = await Promise.all([
    audit
      .find({}, { projection: { before: 0 } })
      .sort({ at: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .toArray(),
    audit.estimatedDocumentCount(),
  ]);
  const items = docs.map((doc) => ({
    id: doc._id.toHexString(),
    at: doc.at.toISOString(),
    username: doc.username,
    action: doc.action,
    contactId: doc.contactId?.toHexString(),
    contactName: doc.contactName,
    departmentId: doc.departmentId?.toHexString(),
    count: doc.count,
    detail: doc.detail,
  }));
  return { items, total };
}

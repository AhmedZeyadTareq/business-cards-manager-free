import { ObjectId, type Filter } from "mongodb";
import type { ContactDoc } from "@/modules/db/mongo";

/** Which contacts a person may read. Comes from requireAccess(), never from a request. */
export type Scope = { kind: "all" } | { kind: "department"; departmentId: ObjectId };

export type Actor = { userId: ObjectId | null; username: string };

/** Who writes, and where new contacts go. */
export type Writer = { scope: Scope; departmentId: ObjectId; actor: Actor };

export function scopeFilter(scope: Scope): Filter<ContactDoc> {
  return scope.kind === "all" ? {} : { DepartmentId: scope.departmentId };
}

/** The Writer for scripts (seed, import, evals): limited to one department. */
export function scriptWriter(departmentId: ObjectId | string, name: string): Writer {
  const id = new ObjectId(departmentId);
  return {
    scope: { kind: "department", departmentId: id },
    departmentId: id,
    actor: { userId: null, username: `script:${name}` },
  };
}

export function toObjectId(id: string): ObjectId | null {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null;
}

import { cookies } from "next/headers";
import { config } from "@/lib/config";
import type { DepartmentDoc, UserDoc } from "@/modules/db/mongo";
import { AppError } from "@/modules/shared/errors";
import { permissionsFor, type Me, type Permission, type Permissions } from "./account.schema";
import { spendAiUse } from "./ai-usage";
import { getDepartmentDoc, listDepartments } from "./departments.repo";
import type { Writer } from "./scope";
import { readSessionToken, SESSION_COOKIE } from "./session";
import { findUserById } from "./users.repo";

export type Access = Writer & {
  user: UserDoc;
  department: { id: string; name: string; isHighManagement: boolean };
  can: Permissions;
};

export type AccessOptions = {
  /** The three AI routes: also spends one of the person's daily AI uses. */
  ai?: boolean;
};

const SIGN_IN = "Please sign in.";

export function accessFor(user: UserDoc, department: DepartmentDoc): Access {
  return {
    scope: department.isHighManagement
      ? { kind: "all" }
      : { kind: "department", departmentId: department._id },
    departmentId: department._id,
    actor: { userId: user._id, username: user.username },
    user,
    department: {
      id: department._id.toHexString(),
      name: department.name,
      isHighManagement: department.isHighManagement,
    },
    can: permissionsFor(user.role),
  };
}

/** Loads the user and department from the database. Throws UNAUTHORIZED for a bad session. */
export async function accessForToken(token: string | undefined): Promise<Access> {
  const session = readSessionToken(token);
  if (!session) throw new AppError("UNAUTHORIZED", SIGN_IN);
  const user = await findUserById(session.userId);
  if (!user || !user.active || user.sessionVersion !== session.sessionVersion) {
    throw new AppError("UNAUTHORIZED", SIGN_IN);
  }
  const department = await getDepartmentDoc(user.departmentId);
  if (!department || !department.active) throw new AppError("UNAUTHORIZED", SIGN_IN);
  return accessFor(user, department);
}

export function checkPermission(access: Access, need?: Permission): void {
  if (!need || access.can[need]) return;
  throw new AppError(
    "FORBIDDEN",
    need === "admin"
      ? "Only administrators can do this."
      : "Your role can only view contacts. Ask an administrator to change it.",
  );
}

/** Everything requireAccess() does, given the cookie value. */
export async function authorize(
  token: string | undefined,
  need?: Permission,
  options: AccessOptions = {},
): Promise<Access> {
  const access = await accessForToken(token);
  checkPermission(access, need);
  if (options.ai) await spendAiUse(access.user._id);
  return access;
}

/**
 * Called first in every API route. A refused session also loses its cookie, so an old
 * but validly signed cookie cannot bounce between /login and the app.
 */
export async function requireAccess(need?: Permission, options?: AccessOptions): Promise<Access> {
  const store = await cookies();
  try {
    return await authorize(store.get(SESSION_COOKIE)?.value, need, options);
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHORIZED") store.delete(SESSION_COOKIE);
    throw error;
  }
}

export async function describeMe(access: Access): Promise<Me> {
  const me: Me = {
    user: {
      id: access.user._id.toHexString(),
      username: access.user.username,
      name: access.user.name,
      role: access.user.role,
    },
    department: access.department,
    can: access.can,
    timeZone: config().APP_TIME_ZONE,
  };
  if (access.department.isHighManagement) {
    me.departments = (await listDepartments()).map(({ id, name, active }) => ({
      id,
      name,
      active,
    }));
  }
  return me;
}

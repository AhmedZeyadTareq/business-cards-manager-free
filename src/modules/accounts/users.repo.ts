import { ObjectId } from "mongodb";
import { collections, type UserDoc } from "@/modules/db/mongo";
import { AppError } from "@/modules/shared/errors";
import type { CreateUserInput, UpdateUserInput, User } from "./account.schema";
import { getDepartmentDoc } from "./departments.repo";
import { clearLocks } from "./login-attempts";
import { hashPassword } from "./password";
import { toObjectId } from "./scope";

export function toUser(doc: UserDoc): User {
  return {
    id: doc._id.toHexString(),
    username: doc.username,
    name: doc.name,
    departmentId: doc.departmentId.toHexString(),
    role: doc.role,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listUsers(): Promise<User[]> {
  const docs = await collections().users.find({}).sort({ username: 1 }).toArray();
  return docs.map(toUser);
}

export async function findUserByUsername(username: string): Promise<UserDoc | null> {
  return collections().users.findOne({ username: username.trim().toLowerCase() });
}

export async function findUserById(id: ObjectId | string): Promise<UserDoc | null> {
  const _id = typeof id === "string" ? toObjectId(id) : id;
  return _id ? collections().users.findOne({ _id }) : null;
}

/** Admins must be in High Management, and a user can only be placed in an active department. */
async function checkPlacement(departmentId: string | ObjectId, role: string): Promise<ObjectId> {
  const department = await getDepartmentDoc(departmentId);
  if (!department) throw new AppError("VALIDATION", "Choose a department.");
  if (!department.active) {
    throw new AppError("VALIDATION", "That department is not active.");
  }
  if (role === "admin" && !department.isHighManagement) {
    throw new AppError("VALIDATION", "Admins must be in High Management.");
  }
  return department._id;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const departmentId = await checkPlacement(input.departmentId, input.role);
  const now = new Date();
  const doc: UserDoc = {
    _id: new ObjectId(),
    username: input.username,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    departmentId,
    role: input.role,
    active: true,
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await collections().users.insertOne(doc);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError("CONFLICT", "That username is already taken.");
    }
    throw error;
  }
  return toUser(doc);
}

/** Sets a new password and ends every session of the user. */
export async function setPasswordHash(userId: ObjectId, passwordHash: string): Promise<UserDoc> {
  const doc = await collections().users.findOneAndUpdate(
    { _id: userId },
    { $set: { passwordHash, updatedAt: new Date() }, $inc: { sessionVersion: 1 } },
    { returnDocument: "after" },
  );
  if (!doc) throw new AppError("NOT_FOUND", "User not found.");
  return doc;
}

/** An admin edits a user. `actorId` is the admin, for the rules about one's own account. */
export async function updateUser(
  actorId: ObjectId,
  id: string,
  patch: UpdateUserInput,
): Promise<User> {
  const { users } = collections();
  const target = await findUserById(id);
  if (!target) throw new AppError("NOT_FOUND", "User not found.");

  const role = patch.role ?? target.role;
  const active = patch.active ?? target.active;
  const isSelf = target._id.equals(actorId);

  if (isSelf && target.role === "admin" && role !== "admin") {
    throw new AppError("CONFLICT", "You cannot remove your own admin access.");
  }
  if (isSelf && !active) throw new AppError("CONFLICT", "You cannot deactivate yourself.");

  let departmentId = target.departmentId;
  if (patch.departmentId !== undefined || patch.role !== undefined) {
    departmentId = await checkPlacement(patch.departmentId ?? target.departmentId, role);
  }

  const wasActiveAdmin = target.role === "admin" && target.active;
  if (wasActiveAdmin && !(role === "admin" && active)) {
    const others = await users.countDocuments({
      role: "admin",
      active: true,
      _id: { $ne: target._id },
    });
    if (others === 0) throw new AppError("CONFLICT", "At least one active admin must stay.");
  }

  const set: Partial<UserDoc> = { role, active, departmentId, updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.password !== undefined) set.passwordHash = await hashPassword(patch.password);
  // A reset and a deactivation end the user's sessions.
  const endSessions = patch.password !== undefined || (target.active && !active);

  const doc = await users.findOneAndUpdate(
    { _id: target._id },
    { $set: set, ...(endSessions ? { $inc: { sessionVersion: 1 } } : {}) },
    { returnDocument: "after" },
  );
  if (!doc) throw new AppError("NOT_FOUND", "User not found.");
  if (patch.password !== undefined) await clearLocks(doc.username);
  return toUser(doc);
}

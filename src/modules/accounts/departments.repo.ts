import { ObjectId } from "mongodb";
import { collections, type DepartmentDoc } from "@/modules/db/mongo";
import { AppError } from "@/modules/shared/errors";
import { HIGH_MANAGEMENT, type Department, type UpdateDepartmentInput } from "./account.schema";
import { toObjectId } from "./scope";

const COLLATION = { locale: "en", strength: 2 } as const;

function toDepartment(doc: DepartmentDoc): Department {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    isHighManagement: doc.isHighManagement,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

/** Creates the High Management department on first use. */
export async function ensureHighManagement(): Promise<DepartmentDoc> {
  const { departments } = collections();
  const existing = await departments.findOne({ isHighManagement: true });
  if (existing) return existing;
  try {
    await departments.insertOne({
      _id: new ObjectId(),
      name: HIGH_MANAGEMENT,
      isHighManagement: true,
      active: true,
      createdAt: new Date(),
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    // Created by a parallel request, or a department already uses the name.
    await departments.updateOne(
      { name: HIGH_MANAGEMENT },
      { $set: { isHighManagement: true, active: true } },
      { collation: COLLATION },
    );
  }
  const created = await departments.findOne({ isHighManagement: true });
  if (!created) throw new AppError("INTERNAL", "Something went wrong");
  return created;
}

export async function listDepartments(): Promise<Department[]> {
  await ensureHighManagement();
  const docs = await collections()
    .departments.find({})
    .sort({ isHighManagement: -1, name: 1 })
    .collation(COLLATION)
    .toArray();
  return docs.map(toDepartment);
}

export async function getDepartmentDoc(id: ObjectId | string): Promise<DepartmentDoc | null> {
  const _id = typeof id === "string" ? toObjectId(id) : id;
  return _id ? collections().departments.findOne({ _id }) : null;
}

export async function findDepartmentByName(name: string): Promise<DepartmentDoc | null> {
  return collections().departments.findOne({ name: name.trim() }, { collation: COLLATION });
}

export async function createDepartment(name: string): Promise<Department> {
  await ensureHighManagement();
  const doc: DepartmentDoc = {
    _id: new ObjectId(),
    name: name.trim(),
    isHighManagement: false,
    active: true,
    createdAt: new Date(),
  };
  try {
    await collections().departments.insertOne(doc);
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new AppError("CONFLICT", "A department with that name already exists.");
    }
    throw error;
  }
  return toDepartment(doc);
}

export async function updateDepartment(
  id: string,
  patch: UpdateDepartmentInput,
): Promise<Department> {
  const { departments } = collections();
  const doc = await getDepartmentDoc(id);
  if (!doc) throw new AppError("NOT_FOUND", "Department not found.");
  if (doc.isHighManagement && patch.active === false) {
    throw new AppError("CONFLICT", "High Management cannot be deactivated.");
  }
  if (doc.isHighManagement && patch.name !== undefined && patch.name !== doc.name) {
    throw new AppError("CONFLICT", "High Management cannot be renamed.");
  }
  const set: Partial<DepartmentDoc> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length > 0) {
    try {
      await departments.updateOne({ _id: doc._id }, { $set: set });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new AppError("CONFLICT", "A department with that name already exists.");
      }
      throw error;
    }
  }
  return toDepartment({ ...doc, ...set });
}

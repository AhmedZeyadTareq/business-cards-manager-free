import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { CreateDepartmentBody } from "@/modules/accounts/account.schema";
import { createDepartment, listDepartments } from "@/modules/accounts/departments.repo";
import { fail, ok, readJson } from "@/modules/shared/api-response";

export async function GET() {
  try {
    await connection();
    await requireAccess("admin");
    return ok(await listDepartments());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAccess("admin");
    const { name } = CreateDepartmentBody.parse(await readJson(request));
    return ok(await createDepartment(name), 201);
  } catch (error) {
    return fail(error);
  }
}

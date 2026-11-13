import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { CreateUserBody } from "@/modules/accounts/account.schema";
import { createUser, listUsers } from "@/modules/accounts/users.repo";
import { fail, ok, readJson } from "@/modules/shared/api-response";

export async function GET() {
  try {
    await connection();
    await requireAccess("admin");
    return ok(await listUsers());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAccess("admin");
    const body = CreateUserBody.parse(await readJson(request));
    return ok(await createUser(body), 201);
  } catch (error) {
    return fail(error);
  }
}

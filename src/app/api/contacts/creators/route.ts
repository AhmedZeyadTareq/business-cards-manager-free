import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { listCreators } from "@/modules/contacts/contacts.repo";
import { fail, ok } from "@/modules/shared/api-response";

export async function GET() {
  try {
    await connection();
    const access = await requireAccess();
    return ok(await listCreators(access.scope));
  } catch (error) {
    return fail(error);
  }
}

import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { ValuesQuery } from "@/modules/contacts/contact.schema";
import { listValues } from "@/modules/contacts/contacts.repo";
import { fail, ok } from "@/modules/shared/api-response";
import { queryOf } from "@/modules/shared/request";

export async function GET(request: Request) {
  try {
    await connection();
    const access = await requireAccess();
    const { field } = ValuesQuery.parse(queryOf(request));
    return ok(await listValues(access.scope, field));
  } catch (error) {
    return fail(error);
  }
}

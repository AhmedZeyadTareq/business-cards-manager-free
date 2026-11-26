import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { QuickSearchQuery } from "@/modules/contacts/contact.schema";
import { quickSearch } from "@/modules/contacts/contacts.repo";
import { fail, ok } from "@/modules/shared/api-response";
import { queryOf } from "@/modules/shared/request";

export async function GET(request: Request) {
  try {
    await connection();
    const access = await requireAccess();
    const { q, limit } = QuickSearchQuery.parse(queryOf(request));
    return ok(await quickSearch(access.scope, q, limit));
  } catch (error) {
    return fail(error);
  }
}

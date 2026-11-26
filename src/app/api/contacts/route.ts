import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { ListContactsQuery, SaveContactsBody } from "@/modules/contacts/contact.schema";
import { insertContacts, listContacts } from "@/modules/contacts/contacts.repo";
import { fail, ok, readJson } from "@/modules/shared/api-response";
import { queryOf } from "@/modules/shared/request";

export async function GET(request: Request) {
  try {
    await connection();
    const access = await requireAccess();
    const query = ListContactsQuery.parse(queryOf(request));
    return ok(await listContacts(access.scope, query));
  } catch (error) {
    return fail(error);
  }
}

/** The only way contacts are saved: after a person reviewed them. */
export async function POST(request: Request) {
  try {
    const access = await requireAccess("add");
    const body = SaveContactsBody.parse(await readJson(request));
    return ok(await insertContacts(access, body.contacts, body.source), 201);
  } catch (error) {
    return fail(error);
  }
}

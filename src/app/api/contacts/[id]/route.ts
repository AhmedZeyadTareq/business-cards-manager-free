import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { ContactPatch } from "@/modules/contacts/contact.schema";
import { deleteContact, getContact, updateContact } from "@/modules/contacts/contacts.repo";
import { fail, ok, readJson } from "@/modules/shared/api-response";

type Context = RouteContext<"/api/contacts/[id]">;

export async function GET(_request: Request, context: Context) {
  try {
    await connection();
    const access = await requireAccess();
    const { id } = await context.params;
    return ok(await getContact(access.scope, id));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const access = await requireAccess("edit");
    const { id } = await context.params;
    const patch = ContactPatch.parse(await readJson(request));
    return ok(await updateContact(access, id, patch));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const access = await requireAccess("delete");
    const { id } = await context.params;
    return ok(await deleteContact(access, id));
  } catch (error) {
    return fail(error);
  }
}

import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { contactVcard } from "@/modules/contacts/vcard";
import { fail, file } from "@/modules/shared/api-response";

export async function GET(_request: Request, context: RouteContext<"/api/contacts/[id]/vcard">) {
  try {
    await connection();
    const access = await requireAccess();
    const { id } = await context.params;
    const { body, filename } = await contactVcard(access.scope, id);
    return file(body, "text/vcard; charset=utf-8", `inline; filename="${filename}"`);
  } catch (error) {
    return fail(error);
  }
}

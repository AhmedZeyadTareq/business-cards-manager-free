import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { PageQuery } from "@/modules/accounts/account.schema";
import { listAudit } from "@/modules/audit/audit.repo";
import { fail, ok } from "@/modules/shared/api-response";
import { queryOf } from "@/modules/shared/request";

export async function GET(request: Request) {
  try {
    await connection();
    await requireAccess("admin");
    return ok(await listAudit(PageQuery(50).parse(queryOf(request))));
  } catch (error) {
    return fail(error);
  }
}

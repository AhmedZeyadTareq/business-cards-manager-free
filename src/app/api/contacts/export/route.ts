import { connection } from "next/server";
import { requireAccess } from "@/modules/accounts/access";
import { exportForAccess, ExportQuery } from "@/modules/contacts/export";
import { fail, file } from "@/modules/shared/api-response";
import { queryOf } from "@/modules/shared/request";

export async function GET(request: Request) {
  try {
    await connection();
    const access = await requireAccess("export");
    const query = ExportQuery.parse(queryOf(request));
    const { csv, filename } = await exportForAccess(access, query);
    return file(csv, "text/csv; charset=utf-8", `attachment; filename="${filename}"`);
  } catch (error) {
    return fail(error);
  }
}

import { connection } from "next/server";
import { describeMe, requireAccess } from "@/modules/accounts/access";
import { fail, ok } from "@/modules/shared/api-response";

export async function GET() {
  try {
    await connection();
    const access = await requireAccess();
    return ok(await describeMe(access));
  } catch (error) {
    return fail(error);
  }
}

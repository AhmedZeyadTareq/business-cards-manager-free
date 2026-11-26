import { cookies } from "next/headers";
import { requireAccess } from "@/modules/accounts/access";
import { ChangePasswordBody } from "@/modules/accounts/account.schema";
import { changePassword } from "@/modules/accounts/login";
import { isHttps, SESSION_COOKIE, sessionCookieOptions } from "@/modules/accounts/session";
import { fail, ok, readJson } from "@/modules/shared/api-response";

export async function POST(request: Request) {
  try {
    const access = await requireAccess();
    const body = ChangePasswordBody.parse(await readJson(request));
    const { token } = await changePassword(access, body);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(isHttps(request)));
    return ok({ changed: true });
  } catch (error) {
    return fail(error);
  }
}

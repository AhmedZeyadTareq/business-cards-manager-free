import { cookies } from "next/headers";
import { LoginBody } from "@/modules/accounts/account.schema";
import { signIn } from "@/modules/accounts/login";
import { addressOf } from "@/modules/accounts/login-attempts";
import { isHttps, SESSION_COOKIE, sessionCookieOptions } from "@/modules/accounts/session";
import { fail, ok, readJson } from "@/modules/shared/api-response";

export async function POST(request: Request) {
  try {
    const body = LoginBody.parse(await readJson(request));
    const { token } = await signIn({ ...body, address: addressOf(request) });
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(isHttps(request)));
    return ok({ signedIn: true });
  } catch (error) {
    return fail(error);
  }
}

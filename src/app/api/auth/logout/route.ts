import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/modules/accounts/session";
import { fail, ok } from "@/modules/shared/api-response";

export async function POST() {
  try {
    (await cookies()).delete(SESSION_COOKIE);
    return ok({ signedOut: true });
  } catch (error) {
    return fail(error);
  }
}

import { requireAccess } from "@/modules/accounts/access";
import { ask, AskBody } from "@/modules/search/ask";
import { fail, ok, readJson } from "@/modules/shared/api-response";

// Above the largest allowed AI_DEADLINE_MS (280 s), so the host never cuts a request off
// without a message. Must be a literal: Next.js reads it at build time.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const access = await requireAccess(undefined, { ai: true });
    const { question } = AskBody.parse(await readJson(request));
    return ok(await ask(access.scope, question));
  } catch (error) {
    return fail(error);
  }
}

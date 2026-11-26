import { requireAccess } from "@/modules/accounts/access";
import { structureText, StructureTextBody } from "@/modules/extraction/structure-text";
import { fail, ok, readJson } from "@/modules/shared/api-response";

// Above the largest allowed AI_DEADLINE_MS (280 s). Must be a literal.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const access = await requireAccess("add", { ai: true });
    const { text } = StructureTextBody.parse(await readJson(request));
    return ok(await structureText(access.departmentId, text));
  } catch (error) {
    return fail(error);
  }
}

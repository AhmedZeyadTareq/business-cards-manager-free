import { requireAccess } from "@/modules/accounts/access";
import { extractPhoto } from "@/modules/extraction/extract-photo";
import { fail, ok } from "@/modules/shared/api-response";
import { AppError } from "@/modules/shared/errors";

// Above the largest allowed AI_DEADLINE_MS (280 s). Must be a literal.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const access = await requireAccess("add", { ai: true });
    let image: FormDataEntryValue | null;
    try {
      image = (await request.formData()).get("image");
    } catch {
      throw new AppError("VALIDATION", "Choose a photo first.");
    }
    return ok(await extractPhoto(access.departmentId, image instanceof File ? image : null));
  } catch (error) {
    return fail(error);
  }
}

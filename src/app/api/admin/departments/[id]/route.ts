import { requireAccess } from "@/modules/accounts/access";
import { UpdateDepartmentBody } from "@/modules/accounts/account.schema";
import { updateDepartment } from "@/modules/accounts/departments.repo";
import { fail, ok, readJson } from "@/modules/shared/api-response";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/admin/departments/[id]">,
) {
  try {
    await requireAccess("admin");
    const { id } = await context.params;
    const patch = UpdateDepartmentBody.parse(await readJson(request));
    return ok(await updateDepartment(id, patch));
  } catch (error) {
    return fail(error);
  }
}

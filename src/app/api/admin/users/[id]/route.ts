import { requireAccess } from "@/modules/accounts/access";
import { UpdateUserBody } from "@/modules/accounts/account.schema";
import { updateUser } from "@/modules/accounts/users.repo";
import { fail, ok, readJson } from "@/modules/shared/api-response";

export async function PATCH(request: Request, context: RouteContext<"/api/admin/users/[id]">) {
  try {
    const access = await requireAccess("admin");
    const { id } = await context.params;
    const patch = UpdateUserBody.parse(await readJson(request));
    return ok(await updateUser(access.user._id, id, patch));
  } catch (error) {
    return fail(error);
  }
}

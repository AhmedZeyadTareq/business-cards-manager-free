import { AppError } from "@/modules/shared/errors";
import type { Access } from "./access";
import { getDepartmentDoc } from "./departments.repo";
import { clearAttempts, isLocked, recordFailure } from "./login-attempts";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { createSessionToken } from "./session";
import { findUserByUsername, setPasswordHash } from "./users.repo";

const WRONG = "Wrong username or password.";

/** Checks a sign-in and returns a session token. `address` is the caller's network address. */
export async function signIn(input: {
  username: string;
  password: string;
  address: string;
}): Promise<{ token: string }> {
  const username = input.username.trim().toLowerCase();
  if (await isLocked(username, input.address)) {
    throw new AppError(
      "TOO_MANY_REQUESTS",
      "Too many wrong tries. Wait 15 minutes, or ask an administrator to reset your password.",
    );
  }

  const user = await findUserByUsername(username);
  const correct = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyAgainstDummy(input.password);
  if (!user || !correct) {
    // Unknown usernames are counted too, so both cases behave the same.
    await recordFailure(username, input.address);
    throw new AppError("UNAUTHORIZED", WRONG);
  }

  const department = await getDepartmentDoc(user.departmentId);
  if (!user.active || !department || !department.active) {
    throw new AppError("FORBIDDEN", "This account is not active. Ask an administrator for access.");
  }

  await clearAttempts(username, input.address);
  return { token: createSessionToken(user._id.toHexString(), user.sessionVersion) };
}

/** Returns a fresh token for this browser; every other device is signed out. */
export async function changePassword(
  access: Access,
  input: { currentPassword: string; newPassword: string },
): Promise<{ token: string }> {
  if (!(await verifyPassword(input.currentPassword, access.user.passwordHash))) {
    throw new AppError("VALIDATION", "The current password is wrong.");
  }
  const user = await setPasswordHash(access.user._id, await hashPassword(input.newPassword));
  return { token: createSessionToken(user._id.toHexString(), user.sessionVersion) };
}

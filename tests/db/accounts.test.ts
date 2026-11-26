import { beforeAll, describe, expect, it } from "vitest";
import { authorize } from "@/modules/accounts/access";
import { permissionsFor, type Permission, type User } from "@/modules/accounts/account.schema";
import { updateDepartment } from "@/modules/accounts/departments.repo";
import { changePassword, signIn } from "@/modules/accounts/login";
import { SESSION_COOKIE } from "@/modules/accounts/session";
import { createUser, updateUser } from "@/modules/accounts/users.repo";
import { collections } from "@/modules/db/mongo";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as meRoute } from "@/app/api/me/route";
import { POST as passwordRoute } from "@/app/api/me/password/route";
import { GET as contactsRoute, POST as saveRoute } from "@/app/api/contacts/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/contacts/[id]/route";
import { GET as exportRoute } from "@/app/api/contacts/export/route";
import { GET as usersRoute, POST as createUserRoute } from "@/app/api/admin/users/route";
import { PATCH as updateUserRoute } from "@/app/api/admin/users/[id]/route";
import { GET as departmentsRoute } from "@/app/api/admin/departments/route";
import { PATCH as departmentRoute } from "@/app/api/admin/departments/[id]/route";
import { GET as activityRoute } from "@/app/api/admin/activity/route";
import { insertContacts } from "@/modules/contacts/contacts.repo";
import {
  contact,
  jar,
  jsonRequest,
  makeUser,
  makeWorld,
  params,
  PASSWORD,
  read,
  signInAs,
  tokenFor,
  type World,
} from "./helpers";

let world: World;
let contactId: string;

beforeAll(async () => {
  world = await makeWorld();
  const [saved] = await insertContacts(
    world.users.aEditor,
    [contact({ FullName: "Role Target" })],
    "manual",
  );
  contactId = saved.id;
}, 300_000);

describe("roles are enforced at the API", () => {
  const permissions: Permission[] = ["add", "edit", "delete", "export", "admin"];

  it("authorize() allows exactly what the roles table allows", async () => {
    for (const key of ["admin", "hmEditor", "hmViewer", "aEditor", "aViewer"] as const) {
      const access = world.users[key];
      const allowed = permissionsFor(access.user.role);
      for (const need of permissions) {
        const attempt = authorize(tokenFor(access), need);
        if (allowed[need]) await expect(attempt).resolves.toBeTruthy();
        else await expect(attempt, `${key} ${need}`).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });

  it("a viewer can read but every write route answers 403 and keeps the cookie", async () => {
    signInAs(world.users.aViewer);
    expect((await contactsRoute(jsonRequest("/api/contacts", "GET"))).status).toBe(200);
    const responses = [
      await saveRoute(
        jsonRequest("/api/contacts", "POST", { source: "manual", contacts: [{ FullName: "X" }] }),
      ),
      await patchRoute(
        jsonRequest(`/api/contacts/${contactId}`, "PATCH", { City: "X" }),
        params({ id: contactId }),
      ),
      await deleteRoute(
        jsonRequest(`/api/contacts/${contactId}`, "DELETE"),
        params({ id: contactId }),
      ),
      await exportRoute(jsonRequest("/api/contacts/export", "GET")),
    ];
    for (const response of responses) {
      const { status, body } = await read(response);
      expect(status).toBe(403);
      expect(body.error.message).toBe(
        "Your role can only view contacts. Ask an administrator to change it.",
      );
    }
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect(await collections().contacts.countDocuments({ FullName: "Role Target", City: "" })).toBe(
      1,
    );
  });

  it("only admins reach the admin routes", async () => {
    for (const key of ["hmEditor", "aEditor", "aViewer"] as const) {
      signInAs(world.users[key]);
      const responses = [
        await usersRoute(),
        await createUserRoute(jsonRequest("/api/admin/users", "POST", {})),
        await departmentsRoute(),
        await activityRoute(jsonRequest("/api/admin/activity", "GET")),
        await departmentRoute(
          jsonRequest("/x", "PATCH", { active: false }),
          params({ id: world.b._id.toHexString() }),
        ),
      ];
      for (const response of responses) {
        const { status, body } = await read(response);
        expect(status).toBe(403);
        expect(body.error.message).toBe("Only administrators can do this.");
      }
    }
    signInAs(world.users.admin);
    const list = await read<User[]>(await usersRoute());
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body.data)).not.toContain("passwordHash");
    expect(JSON.stringify(list.body.data)).not.toContain("scrypt");
    expect((await activityRoute(jsonRequest("/api/admin/activity", "GET"))).status).toBe(200);
  });

  it("no cookie = 401 everywhere", async () => {
    signInAs(null);
    const { status, body } = await read(await contactsRoute(jsonRequest("/api/contacts", "GET")));
    expect(status).toBe(401);
    expect(body.error).toEqual({ code: "UNAUTHORIZED", message: "Please sign in." });
  });

  it("GET /api/me describes the person; departments only for High Management", async () => {
    signInAs(world.users.aEditor);
    const a = await read<Record<string, unknown>>(await meRoute());
    expect(a.body.data.department).toMatchObject({ name: "Dept A", isHighManagement: false });
    expect(a.body.data.departments).toBeUndefined();
    expect(a.body.data.timeZone).toBe("Asia/Baghdad");
    signInAs(world.users.hmViewer);
    const hm = await read<{ departments: unknown[]; can: Record<string, boolean> }>(
      await meRoute(),
    );
    expect(hm.body.data.departments).toHaveLength(3);
    expect(hm.body.data.can).toEqual({
      add: false,
      edit: false,
      delete: false,
      export: false,
      admin: false,
    });
  });
});

describe("sessions", () => {
  it("a deactivated user is refused on the next request and the cookie is deleted", async () => {
    const person = await makeUser(world.a, "editor", "soon-inactive");
    signInAs(person);
    expect((await meRoute()).status).toBe(200);
    await updateUser(world.users.admin.user._id, person.user._id.toHexString(), { active: false });
    const { status } = await read(await meRoute());
    expect(status).toBe(401);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    await expect(
      signIn({ username: person.user.username, password: PASSWORD, address: "1.1.1.1" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This account is not active. Ask an administrator for access.",
    });
  });

  it("changing your password gives this browser a fresh cookie and ends the old sessions", async () => {
    const person = await makeUser(world.a, "viewer", "changer");
    const oldToken = tokenFor(person);
    signInAs(person);
    const wrong = await read(
      await passwordRoute(
        jsonRequest("/api/me/password", "POST", {
          currentPassword: "nope-nope",
          newPassword: "new-password-1",
        }),
      ),
    );
    expect(wrong.status).toBe(400);
    const done = await read(
      await passwordRoute(
        jsonRequest("/api/me/password", "POST", {
          currentPassword: PASSWORD,
          newPassword: "new-password-1",
        }),
      ),
    );
    expect(done.body.data).toEqual({ changed: true });
    const fresh = jar.get(SESSION_COOKIE)!;
    expect(fresh).not.toBe(oldToken);
    expect((await meRoute()).status).toBe(200);

    // Another device still holding the old cookie lands on the login page once: 401, cookie gone.
    jar.set(SESSION_COOKIE, oldToken);
    expect((await meRoute()).status).toBe(401);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    await expect(
      signIn({ username: person.user.username, password: "new-password-1", address: "1.1.1.1" }),
    ).resolves.toBeTruthy();
  });

  it("people in an inactive department cannot sign in or keep a session; contacts are kept", async () => {
    const admin = world.users.admin;
    const { createDepartment } = await import("@/modules/accounts/departments.repo");
    const temp = await createDepartment("Dept Temp");
    const doc = (await collections().departments.findOne({ name: "Dept Temp" }))!;
    const person = await makeUser(doc, "editor", "temp-person");
    await insertContacts(person, [contact({ FullName: "Kept Contact" })], "manual");
    await updateDepartment(temp.id, { active: false });

    await expect(
      signIn({ username: person.user.username, password: PASSWORD, address: "1.1.1.1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorize(tokenFor(person))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await collections().contacts.countDocuments({ FullName: "Kept Contact" })).toBe(1);
    await expect(
      createUser({
        username: "late.joiner",
        name: "Late",
        password: PASSWORD,
        departmentId: temp.id,
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      updateDepartment(world.hm._id.toHexString(), { active: false }),
    ).rejects.toMatchObject({
      message: "High Management cannot be deactivated.",
    });
    void admin;
  });
});

describe("sign-in", () => {
  it("an unknown username gets the same answer as a wrong password", async () => {
    signInAs(null);
    const unknown = await read(
      await loginRoute(
        jsonRequest("/api/auth/login", "POST", {
          username: "nobody.here",
          password: "whatever-123",
        }),
      ),
    );
    const wrong = await read(
      await loginRoute(
        jsonRequest("/api/auth/login", "POST", {
          username: world.users.aViewer.user.username,
          password: "whatever-123",
        }),
      ),
    );
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toEqual(wrong.body.error);
    expect(wrong.body.error.message).toBe("Wrong username or password.");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("signs in through the route and sets the cookie", async () => {
    signInAs(null);
    const username = world.users.aEditor.user.username.toUpperCase();
    const { status, body } = await read(
      await loginRoute(jsonRequest("/api/auth/login", "POST", { username, password: PASSWORD })),
    );
    expect(status).toBe(200);
    expect(body.data).toEqual({ signedIn: true });
    expect((await meRoute()).status).toBe(200);
  });

  it("5 wrong passwords lock the username for that address only; a reset lifts the lock and ends sessions", async () => {
    const person = await makeUser(world.b, "editor", "locked");
    const username = person.user.username;
    const headers = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
    for (let i = 0; i < 5; i++) {
      const { status } = await read(
        await loginRoute(
          jsonRequest("/api/auth/login", "POST", { username, password: "wrong-wrong" }, headers),
        ),
      );
      expect(status).toBe(401);
    }
    // Even the right password is refused from the locked address...
    const locked = await read(
      await loginRoute(
        jsonRequest("/api/auth/login", "POST", { username, password: PASSWORD }, headers),
      ),
    );
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toBe(
      "Too many wrong tries. Wait 15 minutes, or ask an administrator to reset your password.",
    );
    // ...but the real person, on another address, can still sign in.
    await expect(
      signIn({ username, password: PASSWORD, address: "198.51.100.7" }),
    ).resolves.toBeTruthy();

    const before = tokenFor(person);
    await expect(authorize(before)).resolves.toBeTruthy();
    signInAs(world.users.admin);
    const reset = await read(
      await updateUserRoute(
        jsonRequest("/x", "PATCH", { password: "brand-new-pass" }),
        params({ id: person.user._id.toHexString() }),
      ),
    );
    expect(reset.status).toBe(200);
    await expect(authorize(before)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      signIn({ username, password: "brand-new-pass", address: "203.0.113.9" }),
    ).resolves.toBeTruthy();
  });

  it("a lock ends after 15 minutes", async () => {
    const { isLocked, recordFailure } = await import("@/modules/accounts/login-attempts");
    const start = new Date("2026-01-01T10:00:00Z");
    for (let i = 0; i < 5; i++) await recordFailure("timed.user", "9.9.9.9", start);
    expect(await isLocked("timed.user", "9.9.9.9", new Date("2026-01-01T10:14:00Z"))).toBe(true);
    expect(await isLocked("timed.user", "9.9.9.9", new Date("2026-01-01T10:16:00Z"))).toBe(false);
    expect(await isLocked("timed.user", "8.8.8.8", start)).toBe(false);
    await recordFailure("timed.user", "9.9.9.9", new Date("2026-01-01T10:20:00Z"));
    expect((await collections().loginAttempts.findOne({ _id: "timed.user|9.9.9.9" }))?.count).toBe(
      1,
    );
  });
});

describe("admin rules", () => {
  it("admins must be in High Management", async () => {
    await expect(
      createUser({
        username: "bad.admin",
        name: "Bad",
        password: PASSWORD,
        departmentId: world.a._id.toHexString(),
        role: "admin",
      }),
    ).rejects.toMatchObject({ message: "Admins must be in High Management." });
    const actor = world.users.admin.user._id;
    await expect(
      updateUser(actor, world.users.aEditor.user._id.toHexString(), { role: "admin" }),
    ).rejects.toMatchObject({
      message: "Admins must be in High Management.",
    });
    // Moving an admin out of High Management needs a role change too.
    const second = await makeUser(world.hm, "admin", "second-admin");
    await expect(
      updateUser(actor, second.user._id.toHexString(), { departmentId: world.a._id.toHexString() }),
    ).rejects.toMatchObject({
      message: "Admins must be in High Management.",
    });
    const moved = await updateUser(actor, second.user._id.toHexString(), {
      departmentId: world.a._id.toHexString(),
      role: "editor",
    });
    expect(moved).toMatchObject({ role: "editor", departmentId: world.a._id.toHexString() });
  });

  it("nobody can remove their own admin access or deactivate themselves", async () => {
    const admin = world.users.admin.user._id;
    await makeUser(world.hm, "admin", "spare-admin");
    await expect(updateUser(admin, admin.toHexString(), { role: "editor" })).rejects.toMatchObject({
      message: "You cannot remove your own admin access.",
    });
    await expect(updateUser(admin, admin.toHexString(), { active: false })).rejects.toMatchObject({
      message: "You cannot deactivate yourself.",
    });
  });

  it("the last active admin stays", async () => {
    const { users } = collections();
    const admin = world.users.admin.user._id;
    await users.updateMany({ role: "admin", _id: { $ne: admin } }, { $set: { active: false } });
    // Another admin (even an inactive one acting through a stale call) cannot demote or deactivate the last one.
    const other = (await users.findOne({ role: "admin", _id: { $ne: admin } }))!;
    await expect(
      updateUser(other._id, admin.toHexString(), { role: "viewer" }),
    ).rejects.toMatchObject({
      message: "At least one active admin must stay.",
    });
    await expect(
      updateUser(other._id, admin.toHexString(), { active: false }),
    ).rejects.toMatchObject({
      message: "At least one active admin must stay.",
    });
    expect((await users.findOne({ _id: admin }))?.active).toBe(true);
  });

  it("usernames are unique and stored lowercase; department names are unique ignoring case", async () => {
    const taken = world.users.aViewer.user.username;
    await expect(
      createUser({
        username: taken,
        name: "Dup",
        password: PASSWORD,
        departmentId: world.a._id.toHexString(),
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const { createDepartment } = await import("@/modules/accounts/departments.repo");
    await expect(createDepartment("dept a")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createDepartment("HIGH MANAGEMENT")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("changePassword", () => {
  it("rejects a wrong current password", async () => {
    await expect(
      changePassword(world.users.hmViewer, {
        currentPassword: "wrong",
        newPassword: "long-enough-1",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

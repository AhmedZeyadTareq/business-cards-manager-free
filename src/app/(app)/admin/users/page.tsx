"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, Pencil, Power } from "lucide-react";
import { useMe } from "@/components/MeProvider";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Spinner, StateMessage } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import {
  ROLE_NOTES,
  ROLES,
  type Department,
  type Role,
  type User,
} from "@/modules/accounts/account.schema";

const ROLE_LABELS: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const DIALOG = "m-auto w-[calc(100vw-2rem)] max-w-md";

// One grid for the header and every row, so the columns line up from `md` up.
const COLUMNS =
  "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_4.5rem_4.5rem_8.5rem] md:items-center md:gap-3";

type Action = { kind: "edit" | "password" | "active"; user: User };

/** Admin is offered only for High Management (plan.md §6.5). */
function rolesFor(department: Department | undefined): Role[] {
  return ROLES.filter((role) => role !== "admin" || department?.isHighManagement === true);
}

export default function Page() {
  const me = useMe();
  return (
    <div className="max-w-5xl">
      <PageHeader title="Users">Everyone signs in with their own username and password.</PageHeader>
      {me.can.admin ? (
        <Users />
      ) : (
        <StateMessage kind="error">Only administrators can do this.</StateMessage>
      )}
    </div>
  );
}

function Users() {
  const me = useMe();
  const toast = useToast();
  const users = useApi<User[]>("/api/admin/users");
  const departments = useApi<Department[]>("/api/admin/departments");
  const [action, setAction] = useState<Action | null>(null);

  const error = users.error || departments.error;
  if (!users.data || !departments.data) {
    if (!error) return <StateMessage kind="loading">Loading users…</StateMessage>;
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full">
          <StateMessage kind="error">{error}</StateMessage>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            users.reload();
            departments.reload();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const list = users.data;
  const allDepartments = departments.data;
  const departmentName = (id: string) =>
    allDepartments.find((department) => department.id === id)?.name ?? "";

  function saved(user: User, message: string) {
    users.setData(
      list.some((item) => item.id === user.id)
        ? list.map((item) => (item.id === user.id ? user : item))
        : [...list, user],
    );
    setAction(null);
    toast(message);
  }

  const close = () => setAction(null);

  return (
    <>
      <AddForm departments={allDepartments} onAdded={(user) => saved(user, "User added.")} />

      <h2 className="mb-3 text-base font-semibold text-zinc-900">All users ({list.length})</h2>
      {list.length === 0 ? (
        <StateMessage kind="empty">No users yet.</StateMessage>
      ) : (
        <>
          <div
            aria-hidden
            className={cn(
              "hidden border-b border-zinc-200 px-3 pb-2 text-xs font-medium text-zinc-500",
              COLUMNS,
            )}
          >
            <span>Username</span>
            <span>Full name</span>
            <span>Department</span>
            <span>Role</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <ul className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-zinc-100">
            {list.map((user) => {
              const isMe = user.id === me.user.id;
              return (
                <li
                  key={user.id}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border border-zinc-200 p-3 text-sm",
                    "md:rounded-none md:border-0 md:px-3 md:py-2",
                    !user.active && "bg-zinc-50 text-zinc-500",
                    COLUMNS,
                  )}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      dir="ltr"
                      className={cn(
                        "min-w-0 font-medium break-all",
                        user.active ? "text-zinc-900" : "text-zinc-500",
                      )}
                    >
                      {user.username}
                    </span>
                    {isMe ? <Badge tone="primary">you</Badge> : null}
                  </span>
                  <span dir="auto" className="min-w-0 break-words">
                    <span className="sr-only">Full name: </span>
                    {user.name}
                  </span>
                  <span dir="auto" className="min-w-0 break-words">
                    <span className="sr-only">Department: </span>
                    {departmentName(user.departmentId)}
                  </span>
                  {/* On a phone, role and status share one line. */}
                  <span className="flex flex-wrap items-center gap-2 md:contents">
                    <span>
                      <span className="sr-only">Role: </span>
                      {ROLE_LABELS[user.role]}
                    </span>
                    <span>
                      <span className="sr-only">Status: </span>
                      <Badge tone={user.active ? "green" : "grey"}>
                        {user.active ? "Active" : "Inactive"}
                      </Badge>
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-2 md:mt-0 md:flex-nowrap md:gap-1">
                    <RowButton
                      label="Edit"
                      name={user.username}
                      onClick={() => setAction({ kind: "edit", user })}
                    >
                      <Pencil aria-hidden className="size-4" />
                    </RowButton>
                    <RowButton
                      label="Reset password"
                      name={user.username}
                      onClick={() => setAction({ kind: "password", user })}
                    >
                      <KeyRound aria-hidden className="size-4" />
                    </RowButton>
                    <RowButton
                      label={user.active ? "Deactivate" : "Activate"}
                      name={user.username}
                      onClick={() => setAction({ kind: "active", user })}
                    >
                      <Power aria-hidden className="size-4" />
                    </RowButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Dialog open={action?.kind === "edit"} onClose={close} label="Edit user" className={DIALOG}>
        {action?.kind === "edit" ? (
          <EditForm
            key={action.user.id}
            user={action.user}
            departments={allDepartments}
            onCancel={close}
            onSaved={(user) => saved(user, "User updated.")}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={action?.kind === "password"}
        onClose={close}
        label="Reset password"
        className={DIALOG}
      >
        {action?.kind === "password" ? (
          <PasswordForm
            key={action.user.id}
            user={action.user}
            onCancel={close}
            onSaved={(user) => saved(user, "Password reset.")}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={action?.kind === "active"}
        onClose={close}
        label="Activate or deactivate user"
        className={DIALOG}
      >
        {action?.kind === "active" ? (
          <ActiveForm
            key={action.user.id}
            user={action.user}
            onCancel={close}
            onSaved={(user) => saved(user, user.active ? "User activated." : "User deactivated.")}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/** Text + icon on a phone; icon only (with the same accessible name) from `md` up. */
function RowButton({
  label,
  name,
  onClick,
  children,
}: {
  label: string;
  name: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button variant="outline" size="sm" title={label} onClick={onClick}>
      {children}
      <span className="md:sr-only">{label}</span>
      <span className="sr-only"> {name}</span>
    </Button>
  );
}

function FormError({ children }: { children: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {children}
    </p>
  );
}

function AddForm({
  departments,
  onAdded,
}: {
  departments: Department[];
  onAdded: (user: User) => void;
}) {
  const active = departments.filter((department) => department.active);
  const [form, setForm] = useState({
    username: "",
    name: "",
    password: "",
    departmentId: "",
    role: "editor" as Role,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const department = active.find((item) => item.id === form.departmentId);
  const username = form.username.trim().toLowerCase();
  const badUsername = form.username.length > 0 && !USERNAME.test(username);
  const badPassword = form.password.length > 0 && form.password.length < 8;

  function set(patch: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...patch }));
    setError("");
  }

  function changeDepartment(departmentId: string) {
    const next = active.find((item) => item.id === departmentId);
    // Admin exists only in High Management: leaving it drops the role back to editor.
    const role = form.role === "admin" && !next?.isHighManagement ? "editor" : form.role;
    set({ departmentId, role });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!USERNAME.test(username)) {
      return setError("The username needs 3–32 characters: a-z, 0-9, dot, underscore, hyphen.");
    }
    if (!form.name.trim()) return setError("Enter the full name.");
    if (form.password.length < 8) return setError("The password needs at least 8 characters.");
    if (!department) return setError("Choose a department.");
    setSaving(true);
    setError("");
    try {
      const user = await api<User>("/api/admin/users", {
        method: "POST",
        body: {
          username,
          name: form.name.trim(),
          password: form.password,
          departmentId: department.id,
          role: form.role,
        },
      });
      setForm({ username: "", name: "", password: "", departmentId: "", role: "editor" });
      onAdded(user);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-lg border border-zinc-200 p-4">
      <h2 className="mb-3 text-base font-semibold text-zinc-900">Add a user</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <Label htmlFor="new-username">Username</Label>
          <Input
            id="new-username"
            dir="ltr"
            required
            maxLength={32}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={badUsername || undefined}
            aria-describedby="new-username-hint"
            value={form.username}
            onChange={(event) => set({ username: event.target.value })}
          />
          <p
            id="new-username-hint"
            className={cn("mt-1 text-xs", badUsername ? "text-red-700" : "text-zinc-500")}
          >
            3–32 characters: a-z, 0-9, dot, underscore, hyphen.
          </p>
        </div>
        <div className="min-w-0">
          <Label htmlFor="new-name">Full name</Label>
          <Input
            id="new-name"
            dir="auto"
            required
            maxLength={100}
            autoComplete="off"
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <div className="min-w-0">
          <Label htmlFor="new-first-password">First password</Label>
          <Input
            id="new-first-password"
            type="password"
            required
            maxLength={200}
            autoComplete="new-password"
            aria-invalid={badPassword || undefined}
            aria-describedby="new-first-password-hint"
            value={form.password}
            onChange={(event) => set({ password: event.target.value })}
          />
          <p
            id="new-first-password-hint"
            className={cn("mt-1 text-xs", badPassword ? "text-red-700" : "text-zinc-500")}
          >
            At least 8 characters. Give it to the person; they can change it in My account.
          </p>
        </div>
        <div className="min-w-0">
          <Label htmlFor="new-department">Department</Label>
          <Select
            id="new-department"
            dir="auto"
            required
            value={form.departmentId}
            onChange={(event) => changeDepartment(event.target.value)}
          >
            <option value="">Choose…</option>
            {active.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0">
          <Label htmlFor="new-role">Role</Label>
          <Select
            id="new-role"
            aria-describedby="new-role-hint"
            value={form.role}
            onChange={(event) => set({ role: event.target.value as Role })}
          >
            {rolesFor(department).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          <p id="new-role-hint" className="mt-1 text-xs text-zinc-500">
            {ROLE_NOTES[form.role]}
            {department?.isHighManagement ? "" : " Admin is offered only for High Management."}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <FormError>{error}</FormError>
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : null}
            Add user
          </Button>
        </div>
      </div>
    </form>
  );
}

function DialogActions({
  saving,
  submitLabel,
  danger,
  disabled,
  onCancel,
}: {
  saving: boolean;
  submitLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} disabled={saving || disabled}>
        {saving ? <Spinner /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}

type FormProps = { user: User; onCancel: () => void; onSaved: (user: User) => void };

/** Sends one PATCH for a user and reports the result. */
function usePatch(user: User, onSaved: (user: User) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function patch(body: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      onSaved(await api<User>(`/api/admin/users/${user.id}`, { method: "PATCH", body }));
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  }

  return { saving, error, setError, patch };
}

function EditForm({
  user,
  departments,
  onCancel,
  onSaved,
}: FormProps & { departments: Department[] }) {
  const { saving, error, setError, patch } = usePatch(user, onSaved);
  const [name, setName] = useState(user.name);
  const [departmentId, setDepartmentId] = useState(user.departmentId);
  const [role, setRole] = useState<Role>(user.role);

  // The person's current department stays in the list even when it is inactive.
  const options = departments.filter((item) => item.active || item.id === user.departmentId);
  const department = options.find((item) => item.id === departmentId);
  const roles = rolesFor(department);
  const changed =
    name.trim() !== user.name || departmentId !== user.departmentId || role !== user.role;

  function changeDepartment(id: string) {
    const next = options.find((item) => item.id === id);
    setDepartmentId(id);
    if (role === "admin" && !next?.isHighManagement) setRole("editor");
    setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter the full name.");
    // Only what changed is sent, so an untouched field can never trip a server rule.
    const body: Record<string, unknown> = {};
    if (name.trim() !== user.name) body.name = name.trim();
    if (departmentId !== user.departmentId) body.departmentId = departmentId;
    if (role !== user.role) body.role = role;
    void patch(body);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-semibold text-zinc-900">
        Edit <bdi dir="ltr">{user.username}</bdi>
      </h2>
      <div>
        <Label htmlFor="edit-name">Full name</Label>
        <Input
          id="edit-name"
          dir="auto"
          required
          maxLength={100}
          autoComplete="off"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
      </div>
      <div>
        <Label htmlFor="edit-department">Department</Label>
        <Select
          id="edit-department"
          dir="auto"
          value={departmentId}
          onChange={(event) => changeDepartment(event.target.value)}
        >
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.active ? item.name : `${item.name} (inactive)`}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="edit-role">Role</Label>
        <Select
          id="edit-role"
          aria-describedby="edit-role-hint"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as Role);
            setError("");
          }}
        >
          {roles.map((item) => (
            <option key={item} value={item}>
              {ROLE_LABELS[item]}
            </option>
          ))}
        </Select>
        <p id="edit-role-hint" className="mt-1 text-xs text-zinc-500">
          {ROLE_NOTES[role]}
          {department?.isHighManagement ? "" : " Admin is offered only for High Management."}
        </p>
      </div>
      <FormError>{error}</FormError>
      <DialogActions saving={saving} submitLabel="Save" disabled={!changed} onCancel={onCancel} />
    </form>
  );
}

function PasswordForm({ user, onCancel, onSaved }: FormProps) {
  const { saving, error, setError, patch } = usePatch(user, onSaved);
  const [password, setPassword] = useState("");
  const tooShort = password.length > 0 && password.length < 8;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError("The password needs at least 8 characters.");
    void patch({ password });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-semibold text-zinc-900">
        Reset the password of <bdi dir="ltr">{user.username}</bdi>
      </h2>
      <p className="text-sm text-zinc-600">
        This signs the person out everywhere. Give them the new password; they can change it in My
        account.
      </p>
      <div>
        <Label htmlFor="reset-password">New password</Label>
        <Input
          id="reset-password"
          type="password"
          required
          maxLength={200}
          autoComplete="new-password"
          aria-invalid={tooShort || undefined}
          aria-describedby="reset-password-hint"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError("");
          }}
        />
        <p
          id="reset-password-hint"
          className={cn("mt-1 text-xs", tooShort ? "text-red-700" : "text-zinc-500")}
        >
          At least 8 characters.
        </p>
      </div>
      <FormError>{error}</FormError>
      <DialogActions saving={saving} submitLabel="Reset password" onCancel={onCancel} />
    </form>
  );
}

function ActiveForm({ user, onCancel, onSaved }: FormProps) {
  const { saving, error, patch } = usePatch(user, onSaved);
  const deactivate = user.active;

  function submit(event: FormEvent) {
    event.preventDefault();
    void patch({ active: !user.active });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-semibold text-zinc-900">
        {deactivate ? "Deactivate" : "Activate"} <bdi dir="ltr">{user.username}</bdi>?
      </h2>
      <p className="text-sm text-zinc-600">
        {deactivate
          ? "This person will be signed out and cannot sign in until the account is activated again. Their contacts and activity are kept."
          : "This person will be able to sign in again."}
      </p>
      <FormError>{error}</FormError>
      <DialogActions
        saving={saving}
        submitLabel={deactivate ? "Deactivate" : "Activate"}
        danger={deactivate}
        onCancel={onCancel}
      />
    </form>
  );
}

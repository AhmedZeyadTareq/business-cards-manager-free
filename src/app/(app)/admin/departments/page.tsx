"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Power } from "lucide-react";
import { useMe } from "@/components/MeProvider";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Spinner, StateMessage } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { Department } from "@/modules/accounts/account.schema";

type Action = { kind: "rename" | "active"; department: Department };

/** Mirrors the server rule; the server stays the authority. */
function nameProblem(name: string): string {
  const length = name.trim().length;
  if (length < 2) return "The name needs at least 2 characters.";
  if (length > 80) return "The name can have at most 80 characters.";
  return "";
}

export default function Page() {
  const me = useMe();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Departments">
        Each department sees only its own contacts. High Management sees all.
      </PageHeader>
      {me.can.admin ? (
        <Departments />
      ) : (
        <StateMessage kind="error">Only administrators can do this.</StateMessage>
      )}
    </div>
  );
}

function Departments() {
  const toast = useToast();
  const { data, error, reload, setData } = useApi<Department[]>("/api/admin/departments");
  const [action, setAction] = useState<Action | null>(null);

  if (!data) {
    if (!error) return <StateMessage kind="loading">Loading departments…</StateMessage>;
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full">
          <StateMessage kind="error">{error}</StateMessage>
        </div>
        <Button variant="outline" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  function saved(department: Department, message: string) {
    const list = data ?? [];
    setData(
      list.some((item) => item.id === department.id)
        ? list.map((item) => (item.id === department.id ? department : item))
        : [...list, department],
    );
    setAction(null);
    toast(message);
  }

  return (
    <>
      <AddForm onAdded={(department) => saved(department, "Department added.")} />

      {error ? (
        <div className="mb-3">
          <StateMessage kind="error">{error}</StateMessage>
        </div>
      ) : null}

      {data.length === 0 ? (
        <StateMessage kind="empty">No departments yet.</StateMessage>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((department) => (
            <li
              key={department.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 sm:flex-row sm:items-center sm:gap-3",
                !department.active && "bg-zinc-50",
              )}
            >
              <div className="min-w-0 flex-1">
                <p
                  dir="auto"
                  className={cn(
                    "text-sm font-medium break-words",
                    department.active ? "text-zinc-900" : "text-zinc-500",
                  )}
                >
                  {department.name}
                </p>
                {department.isHighManagement ? (
                  <p className="text-xs text-zinc-500">
                    Sees all contacts. Cannot be renamed or deactivated.
                  </p>
                ) : null}
              </div>
              <Badge
                tone={department.active ? "green" : "grey"}
                className="self-start sm:self-auto"
              >
                {department.active ? "Active" : "Inactive"}
              </Badge>
              {department.isHighManagement ? null : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAction({ kind: "rename", department })}
                  >
                    <Pencil aria-hidden className="size-4" />
                    Rename
                  </Button>
                  <Button
                    variant={department.active ? "danger" : "outline"}
                    size="sm"
                    onClick={() => setAction({ kind: "active", department })}
                  >
                    <Power aria-hidden className="size-4" />
                    {department.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={action?.kind === "rename"}
        onClose={() => setAction(null)}
        label="Rename department"
        className="m-auto w-[calc(100vw-2rem)] max-w-md"
      >
        {action?.kind === "rename" ? (
          <RenameForm
            key={action.department.id}
            department={action.department}
            onCancel={() => setAction(null)}
            onSaved={(department) => saved(department, "Department renamed.")}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={action?.kind === "active"}
        onClose={() => setAction(null)}
        label="Activate or deactivate department"
        className="m-auto w-[calc(100vw-2rem)] max-w-md"
      >
        {action?.kind === "active" ? (
          <ActiveForm
            key={action.department.id}
            department={action.department}
            onCancel={() => setAction(null)}
            onSaved={(department) =>
              saved(
                department,
                department.active ? "Department activated." : "Department deactivated.",
              )
            }
          />
        ) : null}
      </Dialog>
    </>
  );
}

function AddForm({ onAdded }: { onAdded: (department: Department) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = nameProblem(name);
    if (problem) return setError(problem);
    setSaving(true);
    setError("");
    try {
      const department = await api<Department>("/api/admin/departments", {
        method: "POST",
        body: { name: name.trim() },
      });
      setName("");
      onAdded(department);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-lg border border-zinc-200 p-4">
      <h2 className="mb-3 text-base font-semibold text-zinc-900">Add a department</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="department-name">Name</Label>
          <Input
            id="department-name"
            dir="auto"
            required
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
          />
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner /> : null}
          Add department
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function RenameForm({
  department,
  onCancel,
  onSaved,
}: {
  department: Department;
  onCancel: () => void;
  onSaved: (department: Department) => void;
}) {
  const [name, setName] = useState(department.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = nameProblem(name);
    if (problem) return setError(problem);
    setSaving(true);
    setError("");
    try {
      onSaved(
        await api<Department>(`/api/admin/departments/${department.id}`, {
          method: "PATCH",
          body: { name: name.trim() },
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-semibold text-zinc-900">Rename department</h2>
      <div>
        <Label htmlFor="rename-department">Name</Label>
        <Input
          id="rename-department"
          dir="auto"
          required
          maxLength={80}
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || name.trim() === department.name}>
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

function ActiveForm({
  department,
  onCancel,
  onSaved,
}: {
  department: Department;
  onCancel: () => void;
  onSaved: (department: Department) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const deactivate = department.active;

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      onSaved(
        await api<Department>(`/api/admin/departments/${department.id}`, {
          method: "PATCH",
          body: { active: !department.active },
        }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-semibold text-zinc-900">
        {deactivate ? "Deactivate" : "Activate"} <bdi>{department.name}</bdi>?
      </h2>
      <p className="text-sm text-zinc-600">
        {deactivate
          ? "People in an inactive department cannot sign in. Its contacts are kept, and you can activate it again at any time."
          : "People in this department will be able to sign in again."}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant={deactivate ? "danger" : "primary"} onClick={confirm} disabled={saving}>
          {saving ? <Spinner /> : null}
          {deactivate ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useMe } from "@/components/MeProvider";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { ROLE_NOTES, type Role } from "@/modules/accounts/account.schema";

const ROLE_LABELS: Record<Role, string> = { viewer: "Viewer", editor: "Editor", admin: "Admin" };
const EMPTY = { current: "", next: "", again: "" };

export default function Page() {
  const me = useMe();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);

  const tooShort = form.next.length > 0 && form.next.length < 8;
  const mismatch = form.again.length > 0 && form.again !== form.next;

  function set(key: keyof typeof EMPTY, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (form.next.length < 8) return setError("The new password needs at least 8 characters.");
    if (form.next !== form.again) return setError("The two new passwords are not the same.");
    setSaving(true);
    setError("");
    setChanged(false);
    try {
      await api("/api/me/password", {
        method: "POST",
        body: { currentPassword: form.current, newPassword: form.next },
      });
      setForm(EMPTY);
      setChanged(true);
      toast("Password changed.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="My account" />

      <dl className="mb-8 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm">
        <Row label="Username">
          <span dir="ltr">{me.user.username}</span>
        </Row>
        <Row label="Full name">
          <span dir="auto">{me.user.name}</span>
        </Row>
        <Row label="Department">
          <span dir="auto">{me.department.name}</span>
        </Row>
        <Row label="Role">
          <Badge tone="primary">{ROLE_LABELS[me.user.role]}</Badge>
          <span className="mt-1 block text-zinc-600">{ROLE_NOTES[me.user.role]}</span>
        </Row>
      </dl>

      <h2 className="mb-3 text-base font-semibold text-zinc-900">Change password</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Lets password managers attach the new password to the right account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={me.user.username}
          readOnly
          hidden
        />
        <div>
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            value={form.current}
            onChange={(event) => set("current", event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={200}
            aria-invalid={tooShort || undefined}
            aria-describedby="new-password-hint"
            value={form.next}
            onChange={(event) => set("next", event.target.value)}
          />
          <p
            id="new-password-hint"
            className={tooShort ? "mt-1 text-xs text-red-700" : "mt-1 text-xs text-zinc-500"}
          >
            At least 8 characters.
          </p>
        </div>
        <div>
          <Label htmlFor="new-password-again">New password again</Label>
          <Input
            id="new-password-again"
            type="password"
            autoComplete="new-password"
            required
            maxLength={200}
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "new-password-again-hint" : undefined}
            value={form.again}
            onChange={(event) => set("again", event.target.value)}
          />
          {mismatch ? (
            <p id="new-password-again-hint" className="mt-1 text-xs text-red-700">
              The two new passwords are not the same.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {changed ? (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Password changed. Your other devices were signed out.
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : null}
            Change password
          </Button>
        </div>
      </form>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-zinc-500 sm:w-32">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-900">{children}</dd>
    </div>
  );
}

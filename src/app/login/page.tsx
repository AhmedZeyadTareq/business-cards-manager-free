"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: { username, password },
        redirectOn401: false,
      });
      // A full reload, so every page starts from the new session.
      window.location.assign("/");
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-white"
          >
            BC
          </span>
          <h1 className="text-lg font-semibold text-zinc-900">Business Cards Manager</h1>
        </div>
        <div className="mb-4">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className="mb-4">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null}
          Sign in
        </Button>
      </form>
    </main>
  );
}

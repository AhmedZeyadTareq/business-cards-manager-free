"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useApi } from "@/lib/use-api";
import type { Me } from "@/modules/accounts/account.schema";
import { Button } from "./ui/button";
import { StateMessage } from "./ui/spinner";

const MeContext = createContext<Me | null>(null);

/** The signed-in person. Only used inside the app layout, where it is always loaded. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe() outside MeProvider");
  return me;
}

export function MeProvider({ children }: { children: ReactNode }) {
  const { data: me, error, reload } = useApi<Me>("/api/me");

  if (me) return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <StateMessage kind="error">{error}</StateMessage>
        <Button onClick={reload}>Try again</Button>
      </div>
    );
  }
  return (
    <div className="p-8">
      <StateMessage kind="loading">Loading…</StateMessage>
    </div>
  );
}

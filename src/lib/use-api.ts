"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";

type State<T> = { key: string; data?: T; error?: string };

/**
 * Loads `path` from the API and reloads when it changes. `null` loads nothing.
 * While a new path loads, the previous data stays available as `data` (no flicker).
 */
export function useApi<T>(path: string | null): {
  data: T | undefined;
  error: string;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
} {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<State<T>>({ key: "" });
  const key = path === null ? "" : `${version}:${path}`;

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ key, data }))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setState((previous) => ({ key, data: previous.data, error: errorMessage(cause) }));
      });
    return () => controller.abort();
  }, [path, key]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const setData = useCallback((data: T) => setState((previous) => ({ ...previous, data })), []);

  const current = state.key === key;
  return {
    data: path === null ? undefined : state.data,
    error: current ? (state.error ?? "") : "",
    loading: path !== null && !current,
    reload,
    setData,
  };
}

// Browser fetch helper for the API routes. Pages use only this to talk to the server.

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as multipart (photo upload). */
  form?: FormData;
  signal?: AbortSignal;
  /** false on the login form: a 401 there is an answer, not an expired session. */
  redirectOn401?: boolean;
};

let leaving = false;

/** An old session: clear the cookie, go to the login page, and show no error meanwhile. */
async function leaveForLogin(): Promise<never> {
  if (!leaving) {
    leaving = true;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // The login page still works without it.
    }
    window.location.assign("/login");
  }
  return new Promise<never>(() => {});
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    signal: options.signal,
    cache: "no-store",
    credentials: "same-origin",
  };
  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("NETWORK", "Cannot reach the server. Check your connection.", 0);
  }

  if (response.status === 401 && options.redirectOn401 !== false) return leaveForLogin();

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const body = payload as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; details?: unknown } }
    | undefined;

  if (body && body.ok) return body.data;
  if (body && body.ok === false && body.error) {
    throw new ApiError(body.error.code, body.error.message, response.status, body.error.details);
  }
  if (response.status === 413) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "The upload is too large.", 413);
  }
  throw new ApiError("INTERNAL", "Something went wrong", response.status);
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong";
}

/** Builds a query string, leaving out empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

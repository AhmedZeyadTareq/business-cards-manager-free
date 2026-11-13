import { ZodError } from "zod";
import { AppError, ERROR_STATUS, type ErrorCode } from "./errors";

const NO_STORE = { "Cache-Control": "no-store" };

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: NO_STORE });
}

/** A file download (CSV, vCard). Never cached. */
export function file(body: string, contentType: string, disposition: string): Response {
  return new Response(body, {
    status: 200,
    headers: { ...NO_STORE, "Content-Type": contentType, "Content-Disposition": disposition },
  });
}

function errorResponse(code: ErrorCode, message: string, details?: unknown): Response {
  return Response.json(
    { ok: false, error: details === undefined ? { code, message } : { code, message, details } },
    { status: ERROR_STATUS[code], headers: NO_STORE },
  );
}

function isDatabaseError(error: unknown): boolean {
  return error instanceof Error && /^Mongo/.test(error.name);
}

export function fail(error: unknown): Response {
  if (error instanceof AppError) return errorResponse(error.code, error.message, error.details);
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return errorResponse("VALIDATION", "Invalid input", details);
  }
  // Next.js control-flow errors (e.g. prerender bail-outs) must pass through.
  if (typeof error === "object" && error !== null && "digest" in error) throw error;
  if (isDatabaseError(error)) {
    console.error("[db]", (error as Error).name, (error as Error).message);
    return errorResponse("DB_FAILED", "Database is not reachable. Try again in a moment.");
  }
  console.error("[api]", error);
  return errorResponse("INTERNAL", "Something went wrong");
}

/** Reads a JSON request body. Malformed JSON is a VALIDATION error. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION", "Invalid JSON body");
  }
}

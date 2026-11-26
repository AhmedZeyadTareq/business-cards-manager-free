import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

// Signed session tokens: userId.sessionVersion.expiry.signature. No database here,
// so proxy.ts can check a token cheaply. requireAccess() does the real checks.

export const SESSION_COOKIE = "cards_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export type SessionToken = { userId: string; sessionVersion: number; expiresAt: number };

function sign(payload: string): string {
  return createHmac("sha256", config().AUTH_SECRET)
    .update(`session:${payload}`)
    .digest("base64url");
}

export function createSessionToken(
  userId: string,
  sessionVersion: number,
  now: number = Date.now(),
): string {
  const expiry = Math.floor(now / 1000) + SESSION_SECONDS;
  const payload = `${userId}.${sessionVersion}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

/** The token's content when its signature is genuine and it has not expired. */
export function readSessionToken(
  token: string | undefined,
  now: number = Date.now(),
): SessionToken | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, version, expiry, signature] = parts;
  if (!/^[a-f0-9]{24}$/.test(userId) || !/^\d+$/.test(version) || !/^\d+$/.test(expiry)) {
    return null;
  }
  const expected = Buffer.from(sign(`${userId}.${version}.${expiry}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = Number(expiry) * 1000;
  if (expiresAt <= now) return null;
  return { userId, sessionVersion: Number(version), expiresAt };
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: SESSION_SECONDS,
  };
}

/** `secure` cookies only when the request came over HTTPS (not on a local test run). */
export function isHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

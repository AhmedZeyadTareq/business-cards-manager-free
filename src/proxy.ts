import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/modules/accounts/session";

// Checks only that the session cookie is genuine and unexpired (no database).
// requireAccess() in each API route does the real checks.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/auth/login" || pathname === "/api/auth/logout") {
    return NextResponse.next();
  }

  const signedIn = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value) !== null;

  if (pathname === "/login") {
    return signedIn ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (signedIn) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Please sign in." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except static assets and the PWA files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|sw.js|offline.html|icons/).*)",
  ],
};

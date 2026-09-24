import { type NextRequest, NextResponse } from "next/server";

// Kept in sync with src/lib/auth/cookies.ts; proxy code shouldn't import server modules.
const SESSION_COOKIE = "cc_session";
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const PROTECTED_PREFIXES = ["/dashboard", "/parent", "/discover", "/plan", "/roadmap", "/counselor", "/applications"];
// Parent consent links must work before the parent has an account.
const PUBLIC_EXCEPTIONS = ["/parent/consent/"];

/**
 * Optimistic check only: redirects visitors without a session cookie away from signed-in pages,
 * and slides the cookie's lifetime for active users. Real authorization happens in the DAL.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isProtected =
    PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) &&
    !PUBLIC_EXCEPTIONS.some((p) => pathname.startsWith(p));

  if (isProtected && !token) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  if (token) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};

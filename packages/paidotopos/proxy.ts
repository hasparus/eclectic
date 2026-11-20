import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, validSession } from "@/lib/auth";
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (
    process.env.NODE_ENV !== "production" ||
    path === "/login" ||
    path === "/api/auth" ||
    path.startsWith("/p/") ||
    path.startsWith("/_next/static/") ||
    path === "/favicon.ico"
  )
    return NextResponse.next();
  if (
    await validSession(req.cookies.get(COOKIE)?.value, process.env.AUTH_SECRET)
  )
    return NextResponse.next();
  if (path.startsWith("/api/"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL("/login", req.url);
  url.searchParams.set("next", path + req.nextUrl.search);
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next/static).*)"] };

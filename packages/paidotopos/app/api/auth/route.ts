import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, constantEqual, createSession, safeNext } from "@/lib/auth";
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== new URL(req.url).origin)
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const password = process.env.PLAYGROUND_PASSWORD,
      secret = process.env.AUTH_SECRET;
    if (!password || !secret || secret.length < 32)
      return NextResponse.json(
        { error: "Password gate is not configured" },
        { status: 503 },
      );
    const form = await req.formData();
    if (!constantEqual(String(form.get("password") || ""), password))
      return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
    const response = NextResponse.redirect(
      new URL(safeNext(String(form.get("next") || "/")), req.url),
      303,
    );
    response.cookies.set(COOKIE, await createSession(secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to sign in" }, { status: 400 });
  }
}

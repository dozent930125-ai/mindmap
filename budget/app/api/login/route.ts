import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionValue } from "@/lib/auth.ts";

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: "" }));
  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "비밀번호가 틀렸습니다" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  return res;
}

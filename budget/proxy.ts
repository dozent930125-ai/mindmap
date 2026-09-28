import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "./lib/auth.ts";

export async function proxy(request: NextRequest) {
  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // 로그인 화면과 문자 수집 API(자체 토큰으로 인증)는 제외
  matcher: ["/((?!login|api/login|api/ingest|_next/|favicon).*)"],
};

/*
 * 아주 단순한 1인용 인증.
 * - 대시보드: APP_PASSWORD 로 로그인하면 쿠키에 비밀번호 해시를 저장
 * - 문자 수집(/api/ingest): INGEST_TOKEN 을 Authorization 헤더나 ?token= 으로 전달
 * APP_PASSWORD 가 없으면(로컬 개발) 인증 없이 열린다.
 */

export const SESSION_COOKIE = "budget_session";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

export async function sessionValue(): Promise<string> {
  return sha256(`budget-session:${process.env.APP_PASSWORD ?? ""}`);
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  return !!cookie && cookie === (await sessionValue());
}

export function isValidIngestToken(request: Request): boolean {
  const token = process.env.INGEST_TOKEN;
  if (!token) return false;
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = new URL(request.url).searchParams.get("token");
  return header === token || query === token;
}

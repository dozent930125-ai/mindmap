import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidIngestToken, isValidSession } from "@/lib/auth.ts";
import { parseMessage } from "@/lib/parsers.ts";
import { getStore } from "@/lib/store.ts";

/**
 * 문자 한 건을 받아 거래로 저장한다.
 * 아이폰 단축어: POST, 본문 JSON { "text": "<문자 내용>" }, 헤더 Authorization: Bearer <INGEST_TOKEN>
 * 파싱에 실패한 문자는 '확인 필요' 목록에 남겨 나중에 형식을 맞출 수 있게 한다.
 */
export async function POST(request: NextRequest) {
  const authorized =
    isValidIngestToken(request) || (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value));
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let text = "";
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    text = typeof body.text === "string" ? body.text : "";
  } else {
    text = await request.text();
  }
  text = text.trim();
  if (!text) return NextResponse.json({ error: "text가 비어 있습니다" }, { status: 400 });

  const store = getStore();
  const parsed = parseMessage(text);
  if (!parsed) {
    await store.addUnparsed(text);
    return NextResponse.json({ ok: false, message: "형식을 인식하지 못해 '확인 필요'에 저장했습니다" });
  }
  const added = await store.addTransactions([parsed]);
  return NextResponse.json({ ok: true, duplicate: added === 0, transaction: parsed });
}

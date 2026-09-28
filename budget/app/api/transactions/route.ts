import { NextResponse } from "next/server";
import { getStore } from "@/lib/store.ts";
import type { ParsedTransaction } from "@/lib/types.ts";

const SOURCES = ["shinhan-bank", "kakaobank-card", "card", "csv", "manual"];

function valid(t: ParsedTransaction): boolean {
  return (
    typeof t?.occurredAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(t.occurredAt) &&
    Number.isFinite(t.amount) &&
    t.amount > 0 &&
    (t.direction === "in" || t.direction === "out") &&
    typeof t.merchant === "string" &&
    SOURCES.includes(t.source)
  );
}

/** CSV 가져오기: 브라우저에서 파싱한 거래 목록을 한 번에 저장 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const txs: ParsedTransaction[] = Array.isArray(body?.transactions) ? body.transactions : [];
  const ok = txs.filter(valid).map((t) => ({
    occurredAt: t.occurredAt,
    amount: Math.round(t.amount),
    direction: t.direction,
    merchant: t.merchant.slice(0, 200),
    source: t.source,
    account: t.account ?? null,
    balance: Number.isFinite(t.balance) ? t.balance : null,
    cancelled: !!t.cancelled,
    raw: String(t.raw ?? "").slice(0, 2000),
  }));
  const added = await getStore().addTransactions(ok);
  return NextResponse.json({ added, duplicates: ok.length - added, invalid: txs.length - ok.length });
}

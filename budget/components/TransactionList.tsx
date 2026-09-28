"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dayLabel, timeLabel, won } from "@/lib/format.ts";
import { SOURCE_LABELS, type Transaction } from "@/lib/types.ts";

export type Row = Transaction & { category: string; excluded: boolean };

export function TransactionList({ rows, categories }: { rows: Row[]; categories: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setCategory(id: string, value: string) {
    setBusy(id);
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryOverride: value === "__auto" ? null : value }),
    });
    setBusy(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("이 거래를 삭제할까요?")) return;
    setBusy(id);
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  let lastDay = "";
  return (
    <ul className="tx-list">
      {rows.map((t) => {
        const day = t.occurredAt.slice(0, 10);
        const header = day !== lastDay ? <li key={`d-${day}`} className="tx-day">{dayLabel(t.occurredAt)}</li> : null;
        lastDay = day;
        const isIn = t.direction === "in";
        return [
          header,
          <li key={t.id} className={`tx${t.excluded ? " excluded" : ""}`}>
            <span className="merchant">
              {t.merchant}
              {t.cancelled && <span className="muted small"> (승인취소)</span>}
            </span>
            <span className={`amount${isIn ? " in" : ""}`}>
              {isIn ? "+" : "-"}
              {won(t.amount)}
            </span>
            <span className="meta">
              <span>{timeLabel(t.occurredAt)}</span>
              <span>{SOURCE_LABELS[t.source]}</span>
              <select
                aria-label="분류"
                value={t.categoryOverride ?? "__auto"}
                disabled={busy === t.id}
                onChange={(e) => setCategory(t.id, e.target.value)}
              >
                <option value="__auto">자동: {t.categoryOverride ? "규칙 따름" : t.category}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {t.excluded && <span>합계 제외</span>}
            </span>
            <span className="meta" style={{ justifyContent: "flex-end" }}>
              {t.balance != null && <span className="num">잔액 {won(t.balance)}</span>}
              <button className="link" disabled={busy === t.id} onClick={() => remove(t.id)} aria-label="삭제">
                삭제
              </button>
            </span>
          </li>,
        ];
      })}
    </ul>
  );
}

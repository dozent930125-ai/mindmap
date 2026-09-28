"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { won } from "@/lib/format.ts";
import { SOURCE_LABELS, type ParsedTransaction } from "@/lib/types.ts";

const EXAMPLE = `[Web발신]
신한09/28 12:31
110-***-123456
출금 4,500
잔액 1,234,567
 스타벅스`;

export function PasteMessage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message?: string; duplicate?: boolean; transaction?: ParsedTransaction } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setResult(await res.json());
    setBusy(false);
    router.refresh();
  }

  const t = result?.transaction;
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} aria-label="문자 내용" />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="primary" onClick={submit} disabled={busy || !text.trim()}>추가</button>
        <button onClick={() => setText(EXAMPLE)}>예시 넣기</button>
      </div>
      {result && (
        <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
          {t ? (
            <>
              {result.duplicate ? "이미 등록된 거래입니다. " : "추가했습니다. "}
              <b>{t.merchant}</b> · {t.direction === "in" ? "+" : "-"}
              {won(t.amount)} · {t.occurredAt.slice(0, 16).replace("T", " ")} · {SOURCE_LABELS[t.source]}
              {t.cancelled && " · 승인취소"}
            </>
          ) : (
            result.message ?? "실패했습니다"
          )}
        </div>
      )}
    </div>
  );
}

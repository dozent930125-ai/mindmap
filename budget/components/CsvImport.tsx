"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { csvToTransactions, detectMapping, parseCsv } from "@/lib/csv.ts";
import { won } from "@/lib/format.ts";
import { SOURCE_LABELS, type ParsedTransaction, type Source } from "@/lib/types.ts";

/** 국내 은행 CSV는 EUC-KR 인 경우가 많아서 UTF-8 실패 시 EUC-KR 로 다시 읽는다 */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

export function CsvImport() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("shinhan-bank");
  const [txs, setTxs] = useState<ParsedTransaction[]>([]);
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setTxs([]);
    setInfo("");
    if (!file) return;
    const rows = parseCsv(await readText(file));
    const mapping = detectMapping(rows);
    if (!mapping) return setInfo("날짜·금액 열을 찾지 못했습니다. 첫 줄에 '거래일시', '출금', '입금' 같은 제목이 있는지 확인해주세요.");
    const { txs, skipped } = csvToTransactions(rows, mapping, source);
    setTxs(txs);
    setInfo(`${txs.length}건을 찾았습니다${skipped ? ` (${skipped}줄은 날짜/금액이 없어 건너뜀)` : ""}. 확인 후 저장하세요.`);
  }

  async function save() {
    setBusy(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactions: txs.map((t) => ({ ...t, source })) }),
    });
    const r = await res.json();
    setBusy(false);
    setTxs([]);
    setInfo(res.ok ? `${r.added}건 추가, ${r.duplicates}건은 이미 있어서 건너뜀` : "저장 실패");
    router.refresh();
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label className="small">
          출처{" "}
          <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
            {(["shinhan-bank", "kakaobank-card", "card", "csv"] as Source[]).map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="CSV 파일" />
      </div>
      {info && <p className="small">{info}</p>}
      {txs.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="preview">
              <thead>
                <tr><th>일시</th><th>내용</th><th style={{ textAlign: "right" }}>금액</th></tr>
              </thead>
              <tbody>
                {txs.slice(0, 10).map((t, i) => (
                  <tr key={i}>
                    <td className="num">{t.occurredAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{t.merchant}</td>
                    <td className={`num${t.direction === "in" ? " in" : ""}`} style={{ textAlign: "right" }}>
                      {t.direction === "in" ? "+" : "-"}{won(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {txs.length > 10 && <p className="muted small">…외 {txs.length - 10}건</p>}
          <button className="primary" onClick={save} disabled={busy} style={{ marginTop: 8 }}>
            {txs.length}건 저장
          </button>
        </>
      )}
    </div>
  );
}

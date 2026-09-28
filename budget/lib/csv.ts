import { kstIso } from "./kst.ts";
import type { ParsedTransaction, Source } from "./types.ts";

/** 따옴표를 지원하는 최소한의 CSV 파서 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const COLS = {
  date: /거래\s*일시|거래\s*일자|거래일|일시|날짜|이용\s*일|승인\s*일|사용\s*일|date/i,
  time: /시간|시각|time/i,
  out: /출금|찾으신|이용\s*금액|승인\s*금액|결제\s*금액|사용\s*금액/,
  in: /입금|맡기신/,
  amount: /^(거래)?\s*금액$|amount/i,
  kind: /구분|입출|유형|type/i,
  // 앞에 있을수록 우선. 은행 CSV의 '적요'는 보통 '체크카드', '타행이체' 같은 거래 종류라 마지막에 쓴다
  merchant: [/가맹점|상호/, /내용|거래처|받는\s*분|보낸\s*분|기재|description/i, /적요|메모/],
  balance: /잔액|balance/i,
};

export interface CsvMapping {
  headerRow: number;
  date: number;
  time: number;
  out: number;
  in: number;
  amount: number;
  kind: number;
  merchant: number;
  balance: number;
}

/** 헤더 행을 찾아 열 위치를 추정한다. 못 찾으면 null */
export function detectMapping(rows: string[][]): CsvMapping | null {
  for (let h = 0; h < Math.min(rows.length, 20); h++) {
    const header = rows[h];
    const find = (re: RegExp, exclude: number[] = []) =>
      header.findIndex((c, i) => !exclude.includes(i) && re.test(c));
    const date = find(COLS.date);
    if (date < 0) continue;
    const out = find(COLS.out);
    const inn = find(COLS.in);
    const amount = find(COLS.amount, [out, inn]);
    if (out < 0 && inn < 0 && amount < 0) continue;
    const balance = find(COLS.balance);
    return {
      headerRow: h,
      date,
      time: find(COLS.time, [date]),
      out,
      in: inn,
      amount,
      kind: find(COLS.kind),
      merchant: COLS.merchant.map((re) => find(re, [date, out, inn, amount, balance])).find((i) => i >= 0) ?? -1,
      balance,
    };
  }
  return null;
}

const money = (s: string | undefined) => {
  if (!s) return 0;
  const n = Number(s.replace(/[,원\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** "2026-09-28", "2026.09.28 14:23", "20260928", "2026/09/28 14:23:05" 등 */
export function parseCsvDate(dateCell: string, timeCell = ""): string | null {
  const s = `${dateCell} ${timeCell}`.trim();
  const m = s.match(/(\d{4})\s*[-./년]?\s*(\d{1,2})\s*[-./월]?\s*(\d{1,2})\s*일?(?:\D*(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return kstIso(y, mo, d, m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
}

export function csvToTransactions(
  rows: string[][],
  mapping: CsvMapping,
  source: Source = "csv",
): { txs: ParsedTransaction[]; skipped: number } {
  const txs: ParsedTransaction[] = [];
  let skipped = 0;
  for (const row of rows.slice(mapping.headerRow + 1)) {
    const occurredAt = parseCsvDate(row[mapping.date] ?? "", mapping.time >= 0 ? row[mapping.time] : "");
    let amount = 0;
    let direction: "in" | "out" = "out";
    let cancelled = false;
    const outAmt = mapping.out >= 0 ? money(row[mapping.out]) : 0;
    const inAmt = mapping.in >= 0 ? money(row[mapping.in]) : 0;
    if (outAmt > 0) amount = outAmt;
    else if (outAmt < 0) {
      // 카드 명세서의 음수 이용금액 = 승인취소/환불
      amount = -outAmt;
      direction = "in";
      cancelled = true;
    } else if (inAmt > 0) {
      amount = inAmt;
      direction = "in";
    } else if (mapping.amount >= 0) {
      const v = money(row[mapping.amount]);
      const kind = mapping.kind >= 0 ? row[mapping.kind] ?? "" : "";
      amount = Math.abs(v);
      // 금액 열 하나만 있으면: 음수 또는 구분=출금 → 지출, 구분=입금 → 수입, 그 외(카드 명세서 등) → 지출
      direction = v >= 0 && /입금|수입/.test(kind) ? "in" : "out";
    }
    if (!occurredAt || amount <= 0) {
      skipped++;
      continue;
    }
    txs.push({
      occurredAt,
      amount,
      direction,
      merchant: (mapping.merchant >= 0 ? row[mapping.merchant] : "") || (direction === "in" ? "입금" : "출금"),
      source,
      account: null,
      balance: mapping.balance >= 0 && row[mapping.balance] ? money(row[mapping.balance]) : null,
      cancelled,
      raw: row.join(","),
    });
  }
  return { txs, skipped };
}

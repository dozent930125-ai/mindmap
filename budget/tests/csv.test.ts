import { test } from "node:test";
import assert from "node:assert/strict";
import { csvToTransactions, detectMapping, parseCsv, parseCsvDate } from "../lib/csv.ts";

test("은행 형식: 출금/입금 열 분리 + 안내 문구 행", () => {
  const csv = `거래내역조회,,,,
계좌번호,110-123-456789,,,
거래일자,거래시간,적요,출금(원),입금(원),내용,잔액(원)
2026-09-01,09:10:11,체크카드,"4,500",0,스타벅스,"995,500"
2026-09-02,12:00:00,타행이체,0,"50,000",홍길동,"1,045,500"
합계,,,,,,`;
  const rows = parseCsv(csv);
  const m = detectMapping(rows);
  assert.ok(m);
  assert.equal(m.headerRow, 2);
  const { txs, skipped } = csvToTransactions(rows, m, "shinhan-bank");
  assert.equal(skipped, 1);
  assert.equal(txs.length, 2);
  assert.deepEqual(
    txs.map((t) => [t.occurredAt, t.direction, t.amount, t.balance]),
    [
      ["2026-09-01T09:10:00+09:00", "out", 4500, 995500],
      ["2026-09-02T12:00:00+09:00", "in", 50000, 1045500],
    ],
  );
  assert.equal(txs[0].merchant, "스타벅스"); // 적요보다 내용 열 우선
});

test("카드 형식: 음수 이용금액은 승인취소", () => {
  const rows = parseCsv("이용일시,가맹점명,이용금액\n2026.09.03 18:20,배달의민족,23000\n2026.09.04 08:00,카카오T,-7000");
  const m = detectMapping(rows)!;
  const { txs } = csvToTransactions(rows, m, "kakaobank-card");
  assert.equal(txs[0].merchant, "배달의민족");
  assert.equal(txs[0].amount, 23000);
  assert.equal(txs[1].amount, 7000);
  assert.equal(txs[1].direction, "in");
  assert.equal(txs[1].cancelled, true);
});

test("날짜 형식들", () => {
  assert.equal(parseCsvDate("20260928"), "2026-09-28T00:00:00+09:00");
  assert.equal(parseCsvDate("2026/9/8 7:05:00"), "2026-09-08T07:05:00+09:00");
  assert.equal(parseCsvDate("2026년 09월 28일"), "2026-09-28T00:00:00+09:00");
  assert.equal(parseCsvDate("합계"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, categorize, summarize } from "../lib/categorize.ts";
import type { Transaction } from "../lib/types.ts";

const rules = DEFAULT_RULES.map((r, i) => ({ ...r, id: String(i) }));
let n = 0;
const tx = (p: Partial<Transaction>): Transaction => ({
  id: String(n++),
  occurredAt: "2026-09-10T12:00:00+09:00",
  amount: 1000,
  direction: "out",
  merchant: "",
  source: "manual",
  raw: "",
  createdAt: "",
  ...p,
});

test("규칙 순서와 직접 지정", () => {
  assert.equal(categorize(tx({ merchant: "스타벅스 강남" }), rules), "카페");
  assert.equal(categorize(tx({ merchant: "쿠팡이츠" }), rules), "배달");
  assert.equal(categorize(tx({ merchant: "쿠팡와우 월회비" }), rules), "구독");
  assert.equal(categorize(tx({ merchant: "알수없음" }), rules), "미분류");
  assert.equal(categorize(tx({ merchant: "스타벅스", categoryOverride: "접대비" }), rules), "접대비");
  assert.equal(categorize(tx({ merchant: "스타벅스", direction: "in", cancelled: true }), rules), "카페");
});

test("월 요약: 취소는 지출에서 빼고, 이체/카드대금 제외", () => {
  const s = summarize(
    [
      tx({ merchant: "스타벅스", amount: 5000 }),
      tx({ merchant: "스타벅스", amount: 5000, direction: "in", cancelled: true, occurredAt: "2026-09-11T12:00:00+09:00" }),
      tx({ merchant: "GS25", amount: 3000 }),
      tx({ merchant: "카카오뱅크카드 대금", amount: 100000 }),
      tx({ merchant: "급여", amount: 3000000, direction: "in" }),
      tx({ merchant: "GS25", amount: 9999, occurredAt: "2026-08-31T12:00:00+09:00" }),
    ],
    rules,
    "2026-09",
  );
  assert.equal(s.spending, 3000);
  assert.equal(s.income, 3000000);
  assert.equal(s.count, 5);
  assert.deepEqual(s.byCategory, [{ category: "편의점", amount: 3000 }]);
  assert.equal(s.byDay[9].amount, 8000);
  assert.equal(s.byDay[10].amount, -5000);
  assert.equal(s.byDay.length, 30);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessage, parseShinhanBank, parseKakaobankCard } from "../lib/parsers.ts";

const received = new Date("2026-09-28T06:00:00Z"); // KST 15:00

test("신한은행 출금 (여러 줄)", () => {
  const t = parseShinhanBank("[Web발신]\n신한09/28 14:23\n110-***-123456\n출금       15,000\n잔액    1,234,567\n 스타벅스", received);
  assert.ok(t);
  assert.equal(t.occurredAt, "2026-09-28T14:23:00+09:00");
  assert.equal(t.amount, 15000);
  assert.equal(t.direction, "out");
  assert.equal(t.balance, 1234567);
  assert.equal(t.account, "110-***-123456");
  assert.equal(t.merchant, "스타벅스");
});

test("신한은행 입금 (한 줄, 원 표기)", () => {
  const t = parseShinhanBank("[신한은행] 09/25 09:00 입금 3,000,000원 잔액 4,000,000원 (주)회사급여", received);
  assert.ok(t);
  assert.equal(t.direction, "in");
  assert.equal(t.amount, 3000000);
  assert.equal(t.balance, 4000000);
  assert.equal(t.merchant, "(주)회사급여");
});

test("신한카드 문자는 은행 파서가 무시", () => {
  assert.equal(parseShinhanBank("신한카드(1234)승인 홍*동 12,000원 일시불 09/28 14:23 스타벅스", received), null);
});

test("카카오뱅크 카드 승인", () => {
  const t = parseKakaobankCard("카카오뱅크 체크카드(1234) 승인\n홍*동님\n12,000원 일시불\n09/28 14:23\n스타벅스 강남점\n잔액 123,456원", received);
  assert.ok(t);
  assert.equal(t.source, "kakaobank-card");
  assert.equal(t.amount, 12000);
  assert.equal(t.direction, "out");
  assert.equal(t.balance, 123456);
  assert.equal(t.merchant, "스타벅스 강남점");
  assert.equal(t.cancelled, false);
});

test("카카오뱅크 카드 승인취소는 입금 + cancelled", () => {
  const t = parseKakaobankCard("[카카오뱅크] 체크카드(1234) 승인취소 12,000원 09/28 15:00 스타벅스 강남점", received);
  assert.ok(t);
  assert.equal(t.direction, "in");
  assert.equal(t.cancelled, true);
  assert.equal(t.merchant, "스타벅스 강남점");
});

test("연말 문자를 새해에 받으면 작년으로", () => {
  const t = parseShinhanBank("신한12/31 23:50 출금 1,000 잔액 5,000 편의점", new Date("2026-01-01T00:10:00+09:00"));
  assert.equal(t?.occurredAt, "2025-12-31T23:50:00+09:00");
});

test("결제 문자가 아니면 null", () => {
  assert.equal(parseMessage("[Web발신] 인증번호 [123456]을 입력해주세요"), null);
  assert.equal(parseMessage("신한은행 이벤트 안내 입니다"), null);
});

test("parseMessage 가 출처별로 분기", () => {
  assert.equal(parseMessage("신한09/28 14:23 출금 5,000 잔액 1,000 GS25", received)?.source, "shinhan-bank");
  assert.equal(parseMessage("카카오뱅크 체크카드 승인 5,000원 09/28 14:23 GS25", received)?.source, "kakaobank-card");
  assert.equal(parseMessage("현대카드 승인 홍*동 5,000원 일시불 09/28 14:23 GS25", received)?.merchant, "GS25");
});

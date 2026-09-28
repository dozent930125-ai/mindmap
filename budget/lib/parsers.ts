import { inferYear } from "./kst.ts";
import type { ParsedTransaction } from "./types.ts";

/*
 * 문자/알림 파서.
 * 은행·카드사 문자 형식은 조금씩 바뀌므로, 필요한 값(금액·일시·잔액 등)을 정규식으로 뽑고
 * 뽑고 남은 텍스트를 가맹점/상대방 이름으로 쓰는 방식으로 느슨하게 파싱한다.
 */

const num = (s: string) => Number(s.replace(/,/g, ""));

const DATE_RE = /(\d{1,2})\s*[/.월-]\s*(\d{1,2})\s*일?\s+(\d{1,2}):(\d{2})/;
const ACCOUNT_RE = /\d{3}-[\d*]{2,3}-[\d*]{3,7}/;
const NOISE_RE = /\[?\s*(Web발신|국외발신|국제발신)\s*\]?/g;

function parseDate(text: string, received: Date): string | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const [mo, d, h, mi] = [m[1], m[2], m[3], m[4]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return inferYear(mo, d, h, mi, received);
}

/** 정규식에 걸린 조각들을 지우고 남은 텍스트를 한 줄로 정리 */
function leftover(text: string, patterns: RegExp[]): string {
  let rest = text;
  for (const p of patterns) rest = rest.replace(p, " ");
  return rest.replace(/[\[\]]|\(\s*\)/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 신한은행 입출금 알림
 * 예) [Web발신]\n신한09/28 14:23\n110-***-123456\n출금 15,000\n잔액 1,234,567\n 스타벅스
 */
export function parseShinhanBank(text: string, received = new Date()): ParsedTransaction | null {
  const t = text.replace(NOISE_RE, " ");
  if (!/신한/.test(t) || /신한\s*카드/.test(t)) return null;

  const amt = t.match(/(입금|출금)\s*:?\s*([\d,]+)\s*원?/);
  if (!amt) return null;
  const occurredAt = parseDate(t, received);
  if (!occurredAt) return null;

  const bal = t.match(/잔액\s*:?\s*([\d,]+)\s*원?/);
  const account = t.match(ACCOUNT_RE)?.[0] ?? null;

  const merchant = leftover(t, [
    /\[?\s*신한은행\s*\]?/g,
    /신한/g,
    DATE_RE,
    ACCOUNT_RE,
    /(입금|출금)\s*:?\s*[\d,]+\s*원?/,
    /잔액\s*:?\s*[\d,]+\s*원?/,
  ]);

  return {
    occurredAt,
    amount: num(amt[2]),
    direction: amt[1] === "입금" ? "in" : "out",
    merchant: merchant || (amt[1] === "입금" ? "입금" : "출금"),
    source: "shinhan-bank",
    account,
    balance: bal ? num(bal[1]) : null,
    cancelled: false,
    raw: text.trim(),
  };
}

/** 카드 승인/취소 알림 공통 파서 */
function parseCardCommon(
  text: string,
  received: Date,
  source: ParsedTransaction["source"],
  issuerPatterns: RegExp[],
): ParsedTransaction | null {
  const t = text.replace(NOISE_RE, " ");
  if (!/(승인|취소|결제|사용)/.test(t)) return null;

  // 잔액/누적 금액을 먼저 떼어내야 결제 금액과 헷갈리지 않는다
  const bal = t.match(/잔액\s*:?\s*([\d,]+)\s*원?/);
  const body = t.replace(/(잔액|누적|한도)\s*:?\s*[\d,]+\s*원?/g, " ");

  const amt = body.match(/([\d,]*\d)\s*원/);
  if (!amt) return null;
  const occurredAt = parseDate(body, received);
  if (!occurredAt) return null;

  const cancelled = /취소/.test(body);
  const merchant = leftover(body, [
    ...issuerPatterns,
    DATE_RE,
    /([\d,]*\d)\s*원/,
    /(체크|신용)?\s*카드/g,
    /\(?\s*\d{4}\s*\)?/g,
    /[가-힣]\*[가-힣]*\s*님?/g,
    /승인\s*취소|승인|취소|결제|사용/g,
    /일시불|\d+\s*개월|할부/g,
  ]);

  return {
    occurredAt,
    amount: num(amt[1]),
    // 승인취소는 돈이 돌아온 것이므로 입금으로 기록
    direction: cancelled ? "in" : "out",
    merchant: merchant || "(가맹점 미상)",
    source,
    account: null,
    balance: bal ? num(bal[1]) : null,
    cancelled,
    raw: text.trim(),
  };
}

/**
 * 카카오뱅크 카드 결제 알림
 * 예) 카카오뱅크 체크카드(1234) 승인\n홍*동님\n12,000원 일시불\n09/28 14:23\n스타벅스 강남점\n잔액 123,456원
 */
export function parseKakaobankCard(text: string, received = new Date()): ParsedTransaction | null {
  if (!/(카카오\s*뱅크|카뱅)/.test(text)) return null;
  return parseCardCommon(text, received, "kakaobank-card", [/\[?\s*(카카오\s*뱅크|카뱅)\s*\]?/g]);
}

/** 그 외 카드사 문자를 위한 범용 파서 (정확도는 낮을 수 있음) */
export function parseGenericCard(text: string, received = new Date()): ParsedTransaction | null {
  if (!/카드/.test(text)) return null;
  return parseCardCommon(text, received, "card", [/\[?\s*[가-힣A-Z]{1,6}\s*카드\s*\]?/g]);
}

const PARSERS = [parseShinhanBank, parseKakaobankCard, parseGenericCard];

export function parseMessage(text: string, received = new Date()): ParsedTransaction | null {
  for (const p of PARSERS) {
    const r = p(text, received);
    if (r && r.amount > 0) return r;
  }
  return null;
}

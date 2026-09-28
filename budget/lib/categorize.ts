import type { Direction, Rule, Transaction } from "./types.ts";

export const UNCATEGORIZED = "미분류";
export const INCOME_DEFAULT = "기타수입";

/** 지출/수입 합계에서 빼는 분류. 내 계좌 간 이체나 카드대금이 두 번 잡히는 것을 막는다. */
export const EXCLUDED_CATEGORIES = ["이체", "카드대금"];

export const DEFAULT_RULES: Omit<Rule, "id">[] = [
  { keyword: "스타벅스|이디야|투썸|메가커피|메가MGC|컴포즈|빽다방|폴바셋|커피", category: "카페", direction: "out" },
  { keyword: "넷플릭스|유튜브|스포티파이|멜론|디즈니|티빙|쿠팡와우", category: "구독", direction: "out" },
  { keyword: "배달의민족|배민|쿠팡이츠|요기요", category: "배달", direction: "out" },
  { keyword: "GS25|CU|세븐일레븐|이마트24|편의점", category: "편의점", direction: "out" },
  { keyword: "쿠팡|네이버페이|11번가|G마켓|옥션|무신사", category: "쇼핑", direction: "out" },
  { keyword: "이마트|홈플러스|롯데마트|코스트코|마트", category: "장보기", direction: "out" },
  { keyword: "카카오T|택시|티머니|코레일|SRT|주유|버스|지하철", category: "교통", direction: "out" },
  { keyword: "병원|의원|약국", category: "의료", direction: "out" },
  { keyword: "카드대금|카드결제|카카오뱅크카드", category: "카드대금", direction: "out" },
  { keyword: "급여|월급", category: "급여", direction: "in" },
  { keyword: "이자", category: "이자", direction: "in" },
];

function matches(rule: Rule, merchant: string, direction: Direction): boolean {
  if (rule.direction !== "any" && rule.direction !== direction) return false;
  const m = merchant.toLowerCase();
  return rule.keyword
    .split("|")
    .map((k) => k.trim().toLowerCase())
    .some((k) => k.length > 0 && m.includes(k));
}

/** 직접 지정한 분류 > 위에서부터 첫 번째로 맞는 규칙 > 기본값 */
export function categorize(tx: Transaction, rules: Rule[]): string {
  if (tx.categoryOverride) return tx.categoryOverride;
  // 승인취소는 원래 지출의 분류를 따라가야 하므로 지출 규칙으로 매칭
  const direction = tx.cancelled ? "out" : tx.direction;
  const rule = rules.find((r) => matches(r, tx.merchant, direction));
  if (rule) return rule.category;
  return direction === "in" ? INCOME_DEFAULT : UNCATEGORIZED;
}

export interface Summary {
  spending: number;
  income: number;
  count: number;
  byCategory: { category: string; amount: number }[];
  byDay: { day: number; amount: number }[];
}

/** month: "YYYY-MM". 카드 승인취소(입금)는 수입이 아니라 해당 분류의 지출에서 뺀다. */
export function summarize(txs: Transaction[], rules: Rule[], month: string): Summary {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDay = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, amount: 0 }));
  const byCat = new Map<string, number>();
  let spending = 0;
  let income = 0;
  let count = 0;

  for (const tx of txs) {
    if (!tx.occurredAt.startsWith(month)) continue;
    count++;
    const cat = categorize(tx, rules);
    if (EXCLUDED_CATEGORIES.includes(cat)) continue;
    const day = Number(tx.occurredAt.slice(8, 10));
    if (tx.direction === "out" || tx.cancelled) {
      const signed = tx.cancelled ? -tx.amount : tx.amount;
      spending += signed;
      byCat.set(cat, (byCat.get(cat) ?? 0) + signed);
      byDay[day - 1].amount += signed;
    } else {
      income += tx.amount;
    }
  }

  return {
    spending,
    income,
    count,
    byCategory: [...byCat.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    byDay,
  };
}

export type Direction = "in" | "out";

export type Source = "shinhan-bank" | "kakaobank-card" | "card" | "csv" | "manual";

export const SOURCE_LABELS: Record<Source, string> = {
  "shinhan-bank": "신한은행",
  "kakaobank-card": "카카오뱅크카드",
  card: "카드",
  csv: "CSV",
  manual: "직접입력",
};

/** 원본 거래. 분류(category)는 저장하지 않고 규칙으로 매번 계산한다. */
export interface Transaction {
  id: string;
  /** KST 기준 ISO 문자열, 예: 2026-09-28T14:23:00+09:00 */
  occurredAt: string;
  /** 항상 양수(원) */
  amount: number;
  direction: Direction;
  /** 가맹점명 또는 입출금 상대방/적요 */
  merchant: string;
  source: Source;
  account?: string | null;
  balance?: number | null;
  /** 카드 승인취소 여부 */
  cancelled?: boolean;
  raw: string;
  /** 사용자가 직접 지정한 분류. 규칙보다 우선한다. */
  categoryOverride?: string | null;
  createdAt: string;
}

export interface Rule {
  id: string;
  /** 가맹점명에 포함되면 매칭(대소문자 무시). 여러 개는 | 로 구분 */
  keyword: string;
  category: string;
  direction: Direction | "any";
}

export interface UnparsedMessage {
  id: string;
  text: string;
  receivedAt: string;
}

export type ParsedTransaction = Omit<Transaction, "id" | "createdAt" | "categoryOverride">;

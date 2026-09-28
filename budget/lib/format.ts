export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-09-28T14:23:00+09:00" → "9월 28일 (월)" */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${wd})`;
}

export const timeLabel = (iso: string) => iso.slice(11, 16);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

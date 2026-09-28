// 한국 시간(KST, UTC+9, 서머타임 없음) 기준 날짜 계산

const KST_OFFSET_SEC = 9 * 3600;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 지금 시각의 KST 날짜 문자열 (YYYY-MM-DD) */
export function todayKst(nowMs = Date.now()) {
  return new Date(nowMs + KST_OFFSET_SEC * 1000).toISOString().slice(0, 10);
}

export function isValidDate(date) {
  const m = DATE_RE.exec(date ?? '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === date;
}

/**
 * KST 하루의 시작~끝을 유닉스 초로 반환. 오늘이면 끝은 현재 시각.
 * @returns {{from:number, to:number, isToday:boolean}}
 */
export function kstDayRange(date, nowMs = Date.now()) {
  const [y, m, d] = date.split('-').map(Number);
  const from = Date.UTC(y, m - 1, d) / 1000 - KST_OFFSET_SEC;
  const endOfDay = from + 86400 - 1;
  const now = Math.floor(nowMs / 1000);
  return { from, to: Math.min(endOfDay, now), isToday: date === todayKst(nowMs) };
}

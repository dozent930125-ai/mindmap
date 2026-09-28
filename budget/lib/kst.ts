const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → "YYYY-MM-DDTHH:mm:00+09:00" */
export function toKstIso(date: Date): string {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return (
    `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}` +
    `T${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:00+09:00`
  );
}

export function kstIso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+09:00`;
}

/** 현재 KST 기준 "YYYY-MM" */
export function currentMonth(now = new Date()): string {
  return toKstIso(now).slice(0, 7);
}

/**
 * 연도 없이 월/일만 오는 문자(09/28 14:23)의 연도를 추정한다.
 * 받은 시각보다 하루 이상 미래가 되면 작년 거래로 본다 (예: 1월 1일에 받은 12/31 문자).
 */
export function inferYear(month: number, day: number, h: number, mi: number, received: Date): string {
  const year = Number(toKstIso(received).slice(0, 4));
  const iso = kstIso(year, month, day, h, mi);
  if (new Date(iso).getTime() - received.getTime() > 24 * 60 * 60 * 1000) {
    return kstIso(year - 1, month, day, h, mi);
  }
  return iso;
}

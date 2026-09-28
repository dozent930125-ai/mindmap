import Link from "next/link";
import { EXCLUDED_CATEGORIES, categorize, summarize } from "@/lib/categorize.ts";
import { won, shiftMonth } from "@/lib/format.ts";
import { currentMonth } from "@/lib/kst.ts";
import { getStore, usingFileStore } from "@/lib/store.ts";
import { authEnabled } from "@/lib/auth.ts";
import { DailyChart } from "@/components/DailyChart.tsx";
import { TransactionList, type Row } from "@/components/TransactionList.tsx";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();
  const store = getStore();
  const [txs, rules, unparsed] = await Promise.all([store.listTransactions(), store.listRules(), store.listUnparsed()]);
  const s = summarize(txs, rules, month);
  const [, mm] = month.split("-").map(Number);

  const rows: Row[] = txs
    .filter((t) => t.occurredAt.startsWith(month))
    .map((t) => {
      const category = categorize(t, rules);
      return { ...t, category, excluded: EXCLUDED_CATEGORIES.includes(category) };
    });
  const categories = [...new Set([...rules.map((r) => r.category), ...rows.map((r) => r.category), "미분류", "기타수입", ...EXCLUDED_CATEGORIES])];
  const maxCat = s.byCategory[0]?.amount ?? 0;

  return (
    <main>
      {!authEnabled() && (
        <div className="notice warn">
          APP_PASSWORD가 설정되지 않아 누구나 접속할 수 있는 상태입니다. 배포 전에 꼭 설정하세요.
          {usingFileStore() && " (현재 로컬 파일 저장소 사용 중)"}
        </div>
      )}
      {unparsed.length > 0 && (
        <div className="notice">
          인식하지 못한 문자가 {unparsed.length}건 있습니다. <Link href="/setup#unparsed">확인하기</Link>
        </div>
      )}

      <div className="month-nav">
        <Link href={`/?m=${shiftMonth(month, -1)}`} aria-label="이전 달">‹</Link>
        <h1>{month.replace("-", "년 ")}월</h1>
        <Link href={`/?m=${shiftMonth(month, 1)}`} aria-label="다음 달">›</Link>
      </div>

      <div className="tiles">
        <div className="tile hero">
          <div className="label">{mm}월 지출</div>
          <div className="value">{won(s.spending)}</div>
          <div className="sub">이체·카드대금 제외, 승인취소 반영</div>
        </div>
        <div className="tile">
          <div className="label">수입</div>
          <div className="value">{won(s.income)}</div>
        </div>
        <div className="tile">
          <div className="label">거래 건수</div>
          <div className="value">{s.count}건</div>
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>분류별 지출</h2>
          {s.byCategory.length === 0 ? (
            <p className="muted small">이번 달 지출이 없습니다.</p>
          ) : (
            <div className="hbars">
              {s.byCategory.map((c) => (
                <div className="hbar-row" key={c.category}>
                  <span className="name" title={c.category}>{c.category}</span>
                  <div className="track">
                    <div className="fill" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                  </div>
                  <span className="num">
                    {won(c.amount)} <span className="muted">{Math.round((c.amount / s.spending) * 100)}%</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>일별 지출</h2>
          <DailyChart data={s.byDay} month={mm} />
        </section>
      </div>

      <section className="card">
        <h2>거래 내역</h2>
        {rows.length === 0 ? (
          <p className="muted small">
            아직 거래가 없습니다. <Link href="/import">가져오기</Link>에서 문자를 붙여넣거나 CSV를 올려보세요.
          </p>
        ) : (
          <TransactionList rows={rows} categories={categories} />
        )}
      </section>
    </main>
  );
}

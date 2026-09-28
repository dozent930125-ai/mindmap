"use client";

import { useState } from "react";
import { won } from "@/lib/format.ts";

const W = 600;
const H = 160;
const PAD_B = 18;

export function DailyChart({ data, month }: { data: { day: number; amount: number }[]; month: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.amount), 0);
  const slot = W / data.length;
  const barW = Math.max(slot - 2, 1); // 막대 사이 2px 간격
  const plotH = H - PAD_B;

  if (max <= 0) return <p className="muted small">이번 달 지출이 없습니다.</p>;

  const h = hover === null ? null : data[hover];
  return (
    <div className="daily">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${month}월 일별 지출`}>
        <line className="gridline" x1={0} x2={W} y1={plotH} y2={plotH} />
        {data.map((d, i) => {
          const bh = d.amount > 0 ? Math.max((d.amount / max) * (plotH - 4), 2) : 0;
          const x = i * slot + 1;
          return (
            <g key={d.day}>
              <rect
                className="bar-hit"
                x={i * slot}
                y={0}
                width={slot}
                height={plotH}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(i)}
              />
              {bh > 0 && (
                <rect className={`bar${hover === i ? " hover" : ""}`} x={x} y={plotH - bh} width={barW} height={bh} rx={Math.min(4, barW / 2)} />
              )}
            </g>
          );
        })}
        {[1, 10, 20, data.length].map((day) => (
          <text key={day} className="axis" x={(day - 0.5) * slot} y={H - 4} textAnchor="middle">
            {day}일
          </text>
        ))}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${((hover! + 0.5) / data.length) * 100}%`, top: 0 }}>
          {month}/{h.day} · {won(h.amount)}
        </div>
      )}
    </div>
  );
}

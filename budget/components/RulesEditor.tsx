"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Rule } from "@/lib/types.ts";

let tmpId = 0;

export function RulesEditor({ initial }: { initial: Rule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initial);
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);

  const update = (next: Rule[]) => {
    setRules(next);
    setDirty(true);
    setStatus("");
  };
  const edit = (i: number, patch: Partial<Rule>) => update(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  async function save() {
    setStatus("저장 중…");
    const res = await fetch("/api/rules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules }),
    });
    if (!res.ok) return setStatus("저장 실패");
    setRules((await res.json()).rules);
    setDirty(false);
    setStatus("저장했습니다");
    router.refresh();
  }

  return (
    <section className="card">
      <table className="rules-table">
        <thead>
          <tr>
            <th className="kw">키워드</th>
            <th>분류</th>
            <th>대상</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={r.id}>
              <td className="kw">
                <input aria-label="키워드" value={r.keyword} placeholder="스타벅스|투썸" onChange={(e) => edit(i, { keyword: e.target.value })} />
              </td>
              <td>
                <input aria-label="분류" value={r.category} placeholder="카페" onChange={(e) => edit(i, { category: e.target.value })} />
              </td>
              <td>
                <select aria-label="대상" value={r.direction} onChange={(e) => edit(i, { direction: e.target.value as Rule["direction"] })}>
                  <option value="out">지출</option>
                  <option value="in">수입</option>
                  <option value="any">모두</option>
                </select>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="link" onClick={() => move(i, -1)} aria-label="위로">↑</button>
                <button className="link" onClick={() => move(i, 1)} aria-label="아래로">↓</button>
                <button className="link" onClick={() => update(rules.filter((_, j) => j !== i))} aria-label="삭제">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => update([...rules, { id: `new-${++tmpId}`, keyword: "", category: "", direction: "out" }])}>
          + 규칙 추가
        </button>
        <button className="primary" onClick={save} disabled={!dirty}>저장</button>
        <span className="muted small">{status}</span>
      </div>
    </section>
  );
}

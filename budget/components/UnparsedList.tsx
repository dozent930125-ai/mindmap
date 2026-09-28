"use client";

import { useRouter } from "next/navigation";
import { toKstIso } from "@/lib/kst.ts";
import type { UnparsedMessage } from "@/lib/types.ts";

export function UnparsedList({ items }: { items: UnparsedMessage[] }) {
  const router = useRouter();
  if (!items.length) return <p className="muted small">없습니다.</p>;

  async function remove(id: string) {
    await fetch(`/api/unparsed/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div>
      {items.map((u) => (
        <div key={u.id} style={{ marginBottom: 12 }}>
          <div className="muted small" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{toKstIso(new Date(u.receivedAt)).slice(0, 16).replace("T", " ")}</span>
            <button className="link" onClick={() => remove(u.id)}>삭제</button>
          </div>
          <pre>{u.text}</pre>
        </div>
      ))}
    </div>
  );
}

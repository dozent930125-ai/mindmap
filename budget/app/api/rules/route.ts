import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store.ts";
import type { Rule } from "@/lib/types.ts";

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rules)) return NextResponse.json({ error: "rules 배열이 필요합니다" }, { status: 400 });
  const rules: Rule[] = body.rules
    .filter((r: Rule) => typeof r?.keyword === "string" && r.keyword.trim() && typeof r?.category === "string" && r.category.trim())
    .map((r: Rule) => ({
      id: typeof r.id === "string" && r.id && !r.id.startsWith("new-") ? r.id : randomUUID(),
      keyword: r.keyword.trim(),
      category: r.category.trim(),
      direction: r.direction === "in" || r.direction === "out" ? r.direction : "any",
    }));
  await getStore().saveRules(rules);
  return NextResponse.json({ ok: true, rules });
}

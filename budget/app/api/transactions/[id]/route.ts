import { NextResponse } from "next/server";
import { getStore } from "@/lib/store.ts";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const categoryOverride =
    typeof body.categoryOverride === "string" && body.categoryOverride.trim() ? body.categoryOverride.trim() : null;
  await getStore().updateTransaction(id, { categoryOverride });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  await getStore().deleteTransaction(id);
  return NextResponse.json({ ok: true });
}

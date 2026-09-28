import { NextResponse } from "next/server";
import { getStore } from "@/lib/store.ts";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getStore().deleteUnparsed(id);
  return NextResponse.json({ ok: true });
}

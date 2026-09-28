import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RULES } from "./categorize.ts";
import type { ParsedTransaction, Rule, Transaction, UnparsedMessage } from "./types.ts";

/**
 * 같은 문자가 두 번 들어와도 한 번만 저장되도록 거래 내용으로 id를 만든다.
 * (원문 텍스트는 단축어 전달 과정에서 공백이 달라질 수 있어 쓰지 않는다)
 */
export function transactionId(t: ParsedTransaction): string {
  const key = [t.source, t.occurredAt, t.direction, t.amount, t.merchant, t.balance ?? "", t.cancelled ? 1 : 0].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

export interface Store {
  listTransactions(): Promise<Transaction[]>;
  /** 새로 추가된 개수를 돌려준다(중복은 건너뜀) */
  addTransactions(txs: ParsedTransaction[]): Promise<number>;
  updateTransaction(id: string, patch: Partial<Pick<Transaction, "categoryOverride" | "merchant">>): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  listRules(): Promise<Rule[]>;
  saveRules(rules: Rule[]): Promise<void>;
  listUnparsed(): Promise<UnparsedMessage[]>;
  addUnparsed(text: string): Promise<void>;
  deleteUnparsed(id: string): Promise<void>;
}

const now = () => new Date().toISOString();
const defaultRules = (): Rule[] => DEFAULT_RULES.map((r) => ({ ...r, id: randomUUID() }));
const byDateDesc = (a: Transaction, b: Transaction) => b.occurredAt.localeCompare(a.occurredAt);

/* ---------------- 로컬 개발용: data/db.json ---------------- */

interface Db {
  transactions: Transaction[];
  rules: Rule[] | null;
  unparsed: UnparsedMessage[];
}

class FileStore implements Store {
  private file = path.join(process.cwd(), "data", "db.json");
  private queue: Promise<unknown> = Promise.resolve();

  private async read(): Promise<Db> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      return { transactions: [], rules: null, unparsed: [] };
    }
  }

  /** 쓰기는 순서대로 하나씩 처리 */
  private mutate<T>(fn: (db: Db) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const db = await this.read();
      const result = fn(db);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(db, null, 2));
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async listTransactions() {
    return (await this.read()).transactions.sort(byDateDesc);
  }
  addTransactions(txs: ParsedTransaction[]) {
    return this.mutate((db) => {
      const ids = new Set(db.transactions.map((t) => t.id));
      let added = 0;
      for (const t of txs) {
        const id = transactionId(t);
        if (ids.has(id)) continue;
        ids.add(id);
        db.transactions.push({ ...t, id, categoryOverride: null, createdAt: now() });
        added++;
      }
      return added;
    });
  }
  async updateTransaction(id: string, patch: Partial<Transaction>) {
    await this.mutate((db) => {
      const t = db.transactions.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
  }
  async deleteTransaction(id: string) {
    await this.mutate((db) => {
      db.transactions = db.transactions.filter((t) => t.id !== id);
    });
  }
  async listRules() {
    return (await this.read()).rules ?? defaultRules();
  }
  async saveRules(rules: Rule[]) {
    await this.mutate((db) => {
      db.rules = rules;
    });
  }
  async listUnparsed() {
    return (await this.read()).unparsed.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }
  async addUnparsed(text: string) {
    await this.mutate((db) => {
      db.unparsed.push({ id: randomUUID(), text, receivedAt: now() });
    });
  }
  async deleteUnparsed(id: string) {
    await this.mutate((db) => {
      db.unparsed = db.unparsed.filter((u) => u.id !== id);
    });
  }
}

/* ---------------- 배포용: Supabase (schema는 supabase/schema.sql) ---------------- */

type TxRow = {
  id: string;
  occurred_at: string;
  amount: number;
  direction: Transaction["direction"];
  merchant: string;
  source: Transaction["source"];
  account: string | null;
  balance: number | null;
  cancelled: boolean;
  raw: string;
  category_override: string | null;
  created_at: string;
};

const fromRow = (r: TxRow): Transaction => ({
  id: r.id,
  occurredAt: r.occurred_at,
  amount: Number(r.amount),
  direction: r.direction,
  merchant: r.merchant,
  source: r.source,
  account: r.account,
  balance: r.balance === null ? null : Number(r.balance),
  cancelled: r.cancelled,
  raw: r.raw,
  categoryOverride: r.category_override,
  createdAt: r.created_at,
});

function check<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message);
  return res;
}

class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  async listTransactions() {
    const { data } = check(await this.db.from("transactions").select("*").order("occurred_at", { ascending: false }));
    return (data as TxRow[]).map(fromRow);
  }
  async addTransactions(txs: ParsedTransaction[]) {
    if (!txs.length) return 0;
    const rows = new Map<string, Omit<TxRow, "created_at" | "category_override">>();
    for (const t of txs) {
      const id = transactionId(t);
      rows.set(id, {
        id,
        occurred_at: t.occurredAt,
        amount: t.amount,
        direction: t.direction,
        merchant: t.merchant,
        source: t.source,
        account: t.account ?? null,
        balance: t.balance ?? null,
        cancelled: !!t.cancelled,
        raw: t.raw,
      });
    }
    const { data } = check(
      await this.db
        .from("transactions")
        .upsert([...rows.values()], { onConflict: "id", ignoreDuplicates: true })
        .select("id"),
    );
    return data?.length ?? 0;
  }
  async updateTransaction(id: string, patch: Partial<Pick<Transaction, "categoryOverride" | "merchant">>) {
    const row: Partial<TxRow> = {};
    if ("categoryOverride" in patch) row.category_override = patch.categoryOverride ?? null;
    if (patch.merchant !== undefined) row.merchant = patch.merchant;
    check(await this.db.from("transactions").update(row).eq("id", id));
  }
  async deleteTransaction(id: string) {
    check(await this.db.from("transactions").delete().eq("id", id));
  }
  async listRules() {
    const { data } = check(await this.db.from("rules").select("*").order("position"));
    if (!data?.length) return defaultRules();
    return data.map((r) => ({ id: r.id, keyword: r.keyword, category: r.category, direction: r.direction }));
  }
  async saveRules(rules: Rule[]) {
    check(await this.db.from("rules").delete().neq("id", ""));
    if (rules.length) {
      check(await this.db.from("rules").insert(rules.map((r, position) => ({ ...r, position }))));
    }
  }
  async listUnparsed() {
    const { data } = check(await this.db.from("unparsed").select("*").order("received_at", { ascending: false }));
    return (data ?? []).map((r) => ({ id: r.id, text: r.text, receivedAt: r.received_at }));
  }
  async addUnparsed(text: string) {
    check(await this.db.from("unparsed").insert({ id: randomUUID(), text, received_at: now() }));
  }
  async deleteUnparsed(id: string) {
    check(await this.db.from("unparsed").delete().eq("id", id));
  }
}

let store: Store | undefined;

export function getStore(): Store {
  if (!store) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    store = url && key ? new SupabaseStore(createClient(url, key, { auth: { persistSession: false } })) : new FileStore();
  }
  return store;
}

export const usingFileStore = () => !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

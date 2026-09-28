import { getStore } from "@/lib/store.ts";
import { RulesEditor } from "@/components/RulesEditor.tsx";
import { EXCLUDED_CATEGORIES } from "@/lib/categorize.ts";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const rules = await getStore().listRules();
  return (
    <main>
      <h1>분류 규칙</h1>
      <div className="notice">
        가맹점명(또는 입출금 내용)에 키워드가 들어 있으면 해당 분류로 자동 지정됩니다. <b>위에서부터 먼저 맞는 규칙</b>이
        적용되고, 키워드 여러 개는 <code>|</code> 로 구분합니다. 규칙을 저장하면 기존 거래도 전부 다시 분류됩니다.
        <br />
        <b>{EXCLUDED_CATEGORIES.join(", ")}</b> 분류는 지출·수입 합계에서 빠집니다. 내 계좌끼리 옮긴 돈이 두 번 잡히지 않게
        할 때 쓰세요.
      </div>
      <RulesEditor initial={rules} />
    </main>
  );
}

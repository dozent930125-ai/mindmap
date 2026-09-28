import { headers } from "next/headers";
import { getStore } from "@/lib/store.ts";
import { UnparsedList } from "@/components/UnparsedList.tsx";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "내-사이트.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/api/ingest`;
  const hasToken = !!process.env.INGEST_TOKEN;
  const unparsed = await getStore().listUnparsed();

  return (
    <main>
      <h1>연동 설정 (아이폰)</h1>

      {!hasToken && (
        <div className="notice warn">
          INGEST_TOKEN 환경변수가 없어 단축어에서 보낸 문자를 받을 수 없습니다. 길고 무작위한 문자열로 설정하세요.
        </div>
      )}

      <section className="card">
        <h2>1. 문자 알림 신청</h2>
        <ul className="small">
          <li>
            <b>신한은행</b>: 신한 SOL뱅크 앱 → 전체메뉴 → 알림 설정에서 입출금 알림을 <b>문자(SMS)</b>로 받도록 신청합니다.
            문자 알림은 유료일 수 있습니다.
          </li>
          <li>
            <b>카카오뱅크 카드</b>: 카카오뱅크는 결제 알림을 앱 푸시나 카카오톡으로 보냅니다. 아이폰은 이런 알림을 다른 앱이 읽을
            수 없어서, 문자로 받을 수 없다면 <a href="/import">가져오기</a>에서 알림 내용을 붙여넣거나 거래내역 파일을
            올려주세요.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>2. 단축어 자동화 만들기</h2>
        <ol className="steps small">
          <li>
            <b>단축어</b> 앱 → 아래 <b>자동화</b> 탭 → <b>+</b> → <b>메시지</b>
          </li>
          <li>
            <b>메시지 포함</b>에 <code>신한</code>을 입력합니다. 카드 문자도 받으려면 같은 방식으로 자동화를 하나 더
            만듭니다.
          </li>
          <li>
            <b>즉시 실행</b>을 선택하고 다음 → <b>새로운 빈 자동화</b>
          </li>
          <li>
            동작 추가 → <b>URL 콘텐츠 가져오기</b>(Get Contents of URL). URL에는 아래 주소를 넣습니다.
            <pre>{url}</pre>
          </li>
          <li>
            펼쳐서 설정합니다.
            <ul>
              <li>방법: <b>POST</b></li>
              <li>
                헤더 추가: 키 <code>Authorization</code>, 값 <code>Bearer {hasToken ? "<INGEST_TOKEN 값>" : "(토큰 설정 필요)"}</code>
              </li>
              <li>
                요청 본문: <b>JSON</b> → 텍스트 필드 추가, 키 <code>text</code>, 값은 변수 <b>단축어 입력</b>(메시지 → 내용)
              </li>
            </ul>
          </li>
          <li>완료. 이제 문자가 오면 자동으로 가계부에 들어갑니다.</li>
        </ol>
        <p className="muted small">
          테스트: 터미널에서{" "}
          <code>
            curl -X POST {url} -H &quot;Authorization: Bearer 토큰&quot; -H &quot;Content-Type: application/json&quot; -d
            &apos;{`{"text":"신한09/28 12:31 출금 4,500 잔액 100,000 스타벅스"}`}&apos;
          </code>
        </p>
      </section>

      <section className="card" id="unparsed">
        <h2>확인 필요 ({unparsed.length})</h2>
        <p className="muted small">
          형식을 인식하지 못한 문자입니다. 새 형식이면 파서를 추가해야 하고, 결제 문자가 아니면 지워주세요.
        </p>
        <UnparsedList items={unparsed} />
      </section>
    </main>
  );
}

import { PasteMessage } from "@/components/PasteMessage.tsx";
import { CsvImport } from "@/components/CsvImport.tsx";

export default function ImportPage() {
  return (
    <main>
      <h1>가져오기</h1>
      <section className="card">
        <h2>문자·알림 붙여넣기</h2>
        <p className="muted small">
          결제·입출금 문자 한 건을 그대로 붙여넣으세요. 단축어 연동 전에 파싱이 잘 되는지 확인하거나, 카카오뱅크 앱 알림처럼
          자동으로 못 가져오는 내역을 넣을 때 씁니다.
        </p>
        <PasteMessage />
      </section>
      <section className="card">
        <h2>CSV 파일 올리기</h2>
        <p className="muted small">
          은행·카드사 앱이나 홈페이지에서 받은 거래내역 CSV를 올리면 열을 자동으로 찾아 가져옵니다. 이미 있는 거래는
          건너뜁니다. 엑셀(.xlsx) 파일은 엑셀이나 Numbers에서 CSV로 저장한 뒤 올려주세요.
        </p>
        <CsvImport />
      </section>
    </main>
  );
}

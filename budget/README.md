# 자동 가계부

신한은행 입출금 문자와 카카오뱅크 카드 결제 알림을 받아 가계부에 자동으로 입력하는 1인용 웹 대시보드입니다.

- **수집**: 아이폰 단축어(메시지 수신 자동화)로 `/api/ingest`에 문자를 전송하거나, 문자를 직접 붙여넣거나, CSV 파일을 올립니다(EUC-KR 지원).
- **분류**: 키워드 규칙으로 자동 분류합니다. 규칙을 바꾸면 기존 거래도 전부 다시 분류되고, 거래마다 분류를 직접 지정할 수도 있습니다.
- **대시보드**: 월별 지출과 수입, 분류별 지출, 일별 지출, 거래 목록을 보여줍니다. `이체`와 `카드대금` 분류는 합계에서 빠집니다.
- 같은 문자가 두 번 들어와도 한 번만 저장됩니다. 인식하지 못한 문자는 "확인 필요" 목록에 남습니다.

## 로컬 실행

```bash
npm install
npm run dev        # http://localhost:3000 , 데이터는 data/db.json 에 저장
npm test           # 파서/CSV/분류 테스트
```

환경변수를 지정하지 않으면 로그인 없이 열리고, 데이터는 로컬 파일에 저장됩니다.

## 배포 (무료: Vercel + Supabase)

1. [Supabase](https://supabase.com)에서 프로젝트를 만들고, SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. [Vercel](https://vercel.com)에서 이 저장소를 가져오고, Root Directory를 `budget`으로 지정합니다.
3. Vercel 환경변수를 설정합니다.

| 이름 | 설명 |
|---|---|
| `APP_PASSWORD` | 대시보드 로그인 비밀번호 |
| `INGEST_TOKEN` | 단축어가 문자를 보낼 때 쓰는 토큰(길고 무작위한 문자열) |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role 키(서버에서만 사용) |

4. 배포한 사이트의 **연동 설정** 페이지에 나오는 방법대로 아이폰 단축어 자동화를 만듭니다.

## 구조

```
lib/parsers.ts     문자 파서 (신한은행, 카카오뱅크 카드, 범용 카드)
lib/csv.ts         CSV 열 자동 인식
lib/categorize.ts  분류 규칙, 월 요약
lib/store.ts       저장소 (로컬 JSON 파일 / Supabase)
app/api/ingest     문자 수집 API
```

새 은행이나 카드사를 추가할 때는 `lib/parsers.ts`에 파서를 추가하고 `tests/parsers.test.ts`에 실제 문자 예시를 넣으면 됩니다.

# 매출 대시보드

아임웹 오늘 매출을 자동으로 가져오고, 광고비는 직접 입력해서 수익을 보여주는 Cloudflare Worker입니다.

```
수익 = 매출 − (매출 × 2.25%) − 광고비
```

- **매출**: 해당 날짜(KST)에 들어온 주문 중 결제된 금액 합계에서 취소·반품 완료 금액을 뺀 값
  - 입금대기(`PAY_WAIT`) 주문은 제외
  - 전체 취소/반품은 결제액 전액 차감, 부분 취소는 품목 금액 비율로 추정 차감 (화면에 "부분취소(추정)"으로 표시)
- **광고비**: 광고관리자 금액 그대로 날짜별 입력 (Cloudflare KV에 저장되어 PC·휴대폰 어디서나 동일)
- 오늘 날짜는 1분마다 자동 갱신, "새로고침" 버튼은 캐시 없이 즉시 조회

## 배포 (최초 1회)

Node.js 18 이상이 설치된 PC 터미널에서 실행합니다.

```bash
cd dashboard
npm install
npx wrangler login                     # 브라우저에서 Cloudflare 로그인

# 1) 저장소 만들기 → 출력된 id를 wrangler.toml 의 REPLACE_WITH_KV_ID 자리에 붙여넣기
npx wrangler kv namespace create KV

# 2) 비밀값 등록 (명령 실행 후 값을 붙여넣으면 Cloudflare에만 저장됩니다)
npx wrangler secret put IMWEB_API_KEY
npx wrangler secret put IMWEB_SECRET_KEY
npx wrangler secret put DASHBOARD_PASSWORD   # 대시보드 접속 비밀번호 (직접 정하기)

# 3) 배포
npm run deploy
```

배포가 끝나면 `https://sales-dashboard.<계정>.workers.dev` 주소가 출력됩니다. 휴대폰에서 열고 "홈 화면에 추가"하면 앱처럼 쓸 수 있습니다.

## 첫 확인 (아임웹 응답 구조 점검)

로그인 후 브라우저 개발자도구 콘솔에서 아래를 실행하면 오늘 주문 1건의 금액·상태 필드만(주문자 정보 제외) 볼 수 있습니다.

```js
fetch('/api/debug', { headers: { 'x-dashboard-key': '비밀번호' } }).then(r => r.json()).then(console.log)
```

대시보드 매출이 아임웹 관리자 통계와 다르면 이 결과를 공유해주세요.

## 개발

```bash
npm test        # 계산·API 테스트
npm run dev     # 로컬 실행 (비밀값은 .dev.vars 파일에)
```

## 구조

| 파일 | 역할 |
|---|---|
| `src/index.js` | 라우팅, 비밀번호 확인, 캐시 |
| `src/imweb.js` | 아임웹 API 토큰 발급·주문 조회 |
| `src/revenue.js` | 매출·환불·수익 계산 |
| `src/dates.js` | KST 날짜 범위 |
| `src/page.js` | 대시보드 화면 |

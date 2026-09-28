// 대시보드 화면 (데이터는 로그인 후 /api/* 에서 불러옴)
export const PAGE_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>매출 대시보드</title>
<style>
  :root {
    --bg: #f4f5f7; --card: #ffffff; --text: #16181d; --muted: #6b7280; --line: #e5e7eb;
    --accent: #2563eb; --plus: #15803d; --minus: #b91c1c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --card: #181b21; --text: #eef0f3; --muted: #9aa1ac; --line: #2a2f38;
      --accent: #60a5fa; --plus: #4ade80; --minus: #f87171;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", sans-serif;
  }
  main { max-width: 440px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; }
  .datebar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .datebar strong { font-size: 17px; }
  button {
    font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--text);
    border-radius: 10px; padding: 8px 14px; cursor: pointer;
  }
  button:disabled { opacity: .35; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); gap: 12px; }
  .row .label { color: var(--muted); }
  .row .value { font-variant-numeric: tabular-nums; font-weight: 600; }
  .minus { color: var(--minus); }
  .adinput { display: flex; gap: 8px; align-items: center; }
  .adinput input {
    width: 130px; font: inherit; text-align: right; padding: 8px 10px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text); font-variant-numeric: tabular-nums;
  }
  .profit { display: flex; justify-content: space-between; align-items: baseline; padding-top: 16px; }
  .profit .value { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .profit .value.pos { color: var(--plus); }
  .profit .value.neg { color: var(--minus); }
  .meta { color: var(--muted); font-size: 13px; margin-top: 14px; }
  .note { color: var(--muted); font-size: 13px; }
  .error { color: var(--minus); font-size: 14px; margin-top: 12px; }
  .toolbar { display: flex; justify-content: space-between; margin-top: 16px; }
  #login { display: none; }
  #login input { width: 100%; font: inherit; padding: 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); margin: 12px 0; }
  #login button { width: 100%; }
</style>
</head>
<body>
<main>
  <h1>📊 매출 대시보드</h1>

  <section id="login" class="card">
    <div>비밀번호를 입력하세요</div>
    <form id="loginForm">
      <input id="pw" type="password" autocomplete="current-password" required>
      <button class="primary" type="submit">확인</button>
    </form>
    <div id="loginError" class="error"></div>
  </section>

  <section id="dash" style="display:none">
    <div class="datebar">
      <button id="prev" aria-label="이전 날짜">◀</button>
      <strong id="date"></strong>
      <button id="next" aria-label="다음 날짜">▶</button>
    </div>
    <div class="card">
      <div class="row">
        <span class="label">매출 <span class="note" id="orders"></span></span>
        <span class="value" id="revenue">–</span>
      </div>
      <div class="row">
        <span class="label">수수료 <span class="note" id="feeRate"></span></span>
        <span class="value minus" id="fee">–</span>
      </div>
      <div class="row">
        <span class="label">광고비</span>
        <form class="adinput" id="adForm">
          <input id="ad" inputmode="numeric" placeholder="0" aria-label="광고비">
          <button class="primary" type="submit">저장</button>
        </form>
      </div>
      <div class="profit">
        <span class="label">수익</span>
        <span class="value" id="profit">–</span>
      </div>
      <div class="meta" id="meta"></div>
      <div class="error" id="error"></div>
    </div>
    <div class="toolbar">
      <button id="refresh">새로고침</button>
      <button id="logout">로그아웃</button>
    </div>
  </section>
</main>
<script>
(function () {
  var KEY_STORE = 'dashboard-key';
  var key = null;
  try { key = localStorage.getItem(KEY_STORE); } catch (e) {}

  var $ = function (id) { return document.getElementById(id); };
  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var today = function () { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); };
  var shift = function (date, days) {
    var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  var current = today();
  var timer = null;
  var adDirty = false;

  function showLogin(message) {
    $('dash').style.display = 'none';
    $('login').style.display = 'block';
    $('loginError').textContent = message || '';
    $('pw').focus();
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'x-dashboard-key': key || '' }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) { key = null; showLogin(body.error); throw new Error('unauthorized'); }
        if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
        return body;
      });
    });
  }

  function render(s) {
    $('revenue').textContent = won(s.revenue);
    var orderNote = '결제 ' + s.orderCount + '건';
    if (s.cancelledCount) orderNote += ' · 취소/반품 ' + s.cancelledCount + '건';
    if (s.partialCount) orderNote += ' · 부분취소 ' + s.partialCount + '건(추정)';
    $('orders').textContent = orderNote;
    $('feeRate').textContent = (s.feeRate * 100).toFixed(2) + '%';
    $('fee').textContent = '−' + won(s.fee);
    if (!adDirty) $('ad').value = s.adSpendEntered ? s.adSpend.toLocaleString('ko-KR') : '';
    var p = $('profit');
    p.textContent = won(s.profit);
    p.className = 'value ' + (s.profit >= 0 ? 'pos' : 'neg');
    var t = new Date(s.fetchedAt);
    var meta = '매출 기준 시각 ' + t.toLocaleTimeString('ko-KR');
    if (s.refunds) meta += ' · 총 결제 ' + won(s.grossRevenue) + ' − 환불 ' + won(s.refunds);
    if (!s.adSpendEntered) meta += ' · 광고비 미입력';
    $('meta').textContent = meta;
  }

  function load(fresh) {
    $('date').textContent = current + (current === today() ? ' (오늘)' : '');
    $('next').disabled = current >= today();
    $('error').textContent = '';
    var shown = current;
    var slow = setTimeout(function () {
      if (shown === current) $('meta').textContent = '아임웹에서 불러오는 중… (지난 날짜는 10초 정도 걸릴 수 있어요)';
    }, 800);
    return api('/api/summary?date=' + current + (fresh ? '&fresh=1' : ''))
      .then(function (s) { if (shown === current) render(s); })
      .catch(function (e) { if (shown === current && e.message !== 'unauthorized') $('error').textContent = e.message; })
      .then(function () { clearTimeout(slow); });
  }

  function start() {
    $('login').style.display = 'none';
    $('dash').style.display = 'block';
    load(false);
    clearInterval(timer);
    timer = setInterval(function () { if (current === today() && !document.hidden) load(false); }, 60000);
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    key = $('pw').value;
    api('/api/summary?date=' + today()).then(function () {
      try { localStorage.setItem(KEY_STORE, key); } catch (e) {}
      $('pw').value = '';
      start();
    }).catch(function (e) { if (e.message !== 'unauthorized') showLogin(e.message); });
  });

  $('prev').addEventListener('click', function () { current = shift(current, -1); adDirty = false; load(false); });
  $('next').addEventListener('click', function () {
    if (current < today()) { current = shift(current, 1); adDirty = false; load(false); }
  });
  $('refresh').addEventListener('click', function () { load(true); });
  $('logout').addEventListener('click', function () {
    try { localStorage.removeItem(KEY_STORE); } catch (e) {}
    key = null; clearInterval(timer); showLogin('');
  });

  $('ad').addEventListener('input', function () {
    adDirty = true;
    var digits = this.value.replace(/[^0-9]/g, '');
    this.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  });
  $('adForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var amount = Number($('ad').value.replace(/[^0-9]/g, '') || '0');
    api('/api/ad-spend', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: current, amount: amount })
    }).then(function () { adDirty = false; return load(false); })
      .catch(function (e) { if (e.message !== 'unauthorized') $('error').textContent = e.message; });
  });

  if (key) start(); else showLogin('');
})();
</script>
</body>
</html>`;

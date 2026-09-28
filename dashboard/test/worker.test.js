import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function memoryKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
  };
}

const env = () => ({ KV: memoryKV(), FEE_RATE: '0.0225', DASHBOARD_PASSWORD: 'pw', IMWEB_API_KEY: 'k', IMWEB_SECRET_KEY: 's' });
const req = (path, init = {}) => new Request('https://x.dev' + path, init);
const auth = { 'x-dashboard-key': 'pw' };

function mockImweb() {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    if (url.pathname === '/v2/auth') return Response.json({ code: 200, msg: 'SUCCESS', access_token: 'tok' });
    assert.equal(init.headers['access-token'], 'tok');
    if (url.pathname === '/v2/shop/orders') {
      const list = url.searchParams.has('status') || url.searchParams.has('claim_status')
        ? [] : [{ order_no: 1, payment: { payment_amount: 100000 } }];
      return Response.json({ code: 200, msg: 'SUCCESS', data: { pagenation: { total_page: 1 }, list } });
    }
    return Response.json({ code: -1, msg: 'not found' });
  };
  return calls;
}

test('비밀번호 없으면 401', async () => {
  const res = await worker.fetch(req('/api/summary'), env());
  assert.equal(res.status, 401);
});

test('메인 페이지는 HTML', async () => {
  const res = await worker.fetch(req('/'), env());
  assert.equal(res.status, 200);
  assert.match(await res.text(), /매출 대시보드/);
});

test('광고비 저장 후 요약에 반영', async () => {
  mockImweb();
  const e = env();
  const put = await worker.fetch(req('/api/ad-spend', {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2026-09-27', amount: 30000 }),
  }), e);
  assert.equal(put.status, 200);
  const res = await worker.fetch(req('/api/summary?date=2026-09-27', { headers: auth }), e);
  const s = await res.json();
  assert.equal(res.status, 200);
  assert.equal(s.revenue, 100000);
  assert.equal(s.fee, 2250);
  assert.equal(s.adSpend, 30000);
  assert.equal(s.profit, 67750);
  assert.equal(s.cached, false);
  const again = await (await worker.fetch(req('/api/summary?date=2026-09-27', { headers: auth }), e)).json();
  assert.equal(again.cached, true);
});

test('잘못된 광고비 거부', async () => {
  const res = await worker.fetch(req('/api/ad-spend', {
    method: 'PUT', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2026-09-27', amount: -1 }),
  }), env());
  assert.equal(res.status, 400);
});

test('만료된 토큰이면 새로 발급 후 재시도', async () => {
  const e = env();
  await e.KV.put('imweb:token', 'old');
  let authCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/v2/auth') { authCalls++; return Response.json({ code: 200, access_token: 'tok' }); }
    if (init.headers['access-token'] === 'old') return Response.json({ code: -5, msg: 'token expired' });
    return Response.json({ code: 200, data: { pagenation: { total_page: 1 }, list: [] } });
  };
  const res = await worker.fetch(req('/api/summary?date=2026-09-27', { headers: auth }), e);
  assert.equal(res.status, 200);
  assert.equal(authCalls, 1);
  assert.equal(e.KV.m.get('imweb:token'), 'tok');
});

test('아임웹 오류는 메시지와 함께 502', async () => {
  globalThis.fetch = async () => Response.json({ code: -1, msg: 'invalid key' });
  const res = await worker.fetch(req('/api/summary?date=2026-09-27', { headers: auth }), env());
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /invalid key/);
});

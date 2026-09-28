import { isValidDate, kstDayRange, todayKst } from './dates.js';
import { createClient, ImwebError } from './imweb.js';
import { dailyRevenue, profitSummary } from './revenue.js';
import { PAGE_HTML } from './page.js';

const REVENUE_CACHE_TTL_SEC = 60;
const PAST_REVENUE_CACHE_TTL_SEC = 600;
const MAX_AD_SPEND = 1_000_000_000_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function isAuthorized(request, env) {
  if (!env.DASHBOARD_PASSWORD) return false;
  const given = request.headers.get('x-dashboard-key') ?? '';
  const [a, b] = await Promise.all([sha256(given), sha256(env.DASHBOARD_PASSWORD)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function dateParam(url) {
  const date = url.searchParams.get('date') ?? todayKst();
  return isValidDate(date) ? date : null;
}

const adKey = (date) => `ad:${date}`;

async function getRevenue(env, date, fresh) {
  const cacheKey = `rev:${date}`;
  if (!fresh) {
    const cached = await env.KV.get(cacheKey, 'json');
    if (cached) return { ...cached, cached: true };
  }
  const range = kstDayRange(date);
  const result = { ...(await dailyRevenue(createClient(env), range)), fetchedAt: new Date().toISOString() };
  await env.KV.put(cacheKey, JSON.stringify(result), {
    expirationTtl: range.isToday ? REVENUE_CACHE_TTL_SEC : PAST_REVENUE_CACHE_TTL_SEC,
  });
  return { ...result, cached: false };
}

async function handleSummary(url, env) {
  const date = dateParam(url);
  if (!date) return json({ error: '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' }, 400);
  if (date > todayKst()) return json({ error: '미래 날짜는 조회할 수 없습니다' }, 400);

  const [rev, adRaw] = await Promise.all([
    getRevenue(env, date, url.searchParams.get('fresh') === '1'),
    env.KV.get(adKey(date)),
  ]);
  const adSpend = adRaw === null ? 0 : Number(adRaw);
  const feeRate = Number(env.FEE_RATE ?? '0.0225');
  return json({
    date,
    ...rev,
    feeRate,
    adSpend,
    adSpendEntered: adRaw !== null,
    ...profitSummary({ revenue: rev.revenue, adSpend, feeRate }),
  });
}

async function handleAdSpend(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON 형식이 아닙니다' }, 400);
  }
  const { date, amount } = body ?? {};
  if (!isValidDate(date)) return json({ error: '날짜 형식이 올바르지 않습니다' }, 400);
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AD_SPEND) {
    return json({ error: '광고비는 0 이상의 정수(원)로 입력해주세요' }, 400);
  }
  await env.KV.put(adKey(date), String(amount));
  return json({ ok: true, date, amount });
}

// 아임웹 응답 구조 확인용. 개인정보(주문자·배송지)는 빼고 금액·상태만 보여줍니다.
async function handleDebug(url, env) {
  const date = dateParam(url);
  if (!date) return json({ error: '날짜 형식이 올바르지 않습니다' }, 400);
  const client = createClient(env);
  const range = kstDayRange(date);
  const orders = await client.listOrders({ order_date_from: range.from, order_date_to: range.to });
  const sample = orders[0];
  let prodOrders = null;
  if (sample) {
    prodOrders = (await client.listProdOrders(String(sample.order_no))).map((p) => ({
      status: p.status,
      items: (p.items ?? []).map((i) => ({ payment: i.payment })),
    }));
  }
  return json({
    date,
    range,
    orderCount: orders.length,
    sampleOrderKeys: sample ? Object.keys(sample) : null,
    samplePayment: sample?.payment ?? null,
    sampleProdOrders: prodOrders,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(PAGE_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    if (!(await isAuthorized(request, env))) return json({ error: '비밀번호가 올바르지 않습니다' }, 401);

    try {
      if (url.pathname === '/api/summary' && request.method === 'GET') return await handleSummary(url, env);
      if (url.pathname === '/api/ad-spend' && request.method === 'PUT') return await handleAdSpend(request, env);
      if (url.pathname === '/api/debug' && request.method === 'GET') return await handleDebug(url, env);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      const message = e instanceof ImwebError ? e.message : '서버 오류가 발생했습니다';
      console.error(e);
      return json({ error: message }, 502);
    }
  },
};

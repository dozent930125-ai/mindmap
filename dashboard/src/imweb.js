// 아임웹 오픈 API(v2) 클라이언트
// 인증: API 키/시크릿으로 access_token 발급 → 요청 헤더 `access-token`

const API = 'https://api.imweb.me/v2';
const TOKEN_KEY = 'imweb:token';
const TOKEN_TTL_SEC = 50 * 60;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
// 아임웹은 짧은 시간에 요청이 몰리면 code -7(TOO MANY REQUEST)을 돌려줍니다.
const RATE_LIMIT_CODE = -7;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 700;

export class ImwebError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ImwebError(`아임웹 응답을 읽을 수 없습니다 (HTTP ${res.status})`);
  }
  // v2 API는 HTTP 200이어도 본문 code로 오류를 알려줍니다.
  if (!res.ok || (body.code !== undefined && Number(body.code) !== 200)) {
    const code = Number(body.code ?? res.status);
    throw new ImwebError(`아임웹 오류: ${body.msg ?? 'unknown'} (code ${code})`, code);
  }
  return body;
}

async function issueToken(env) {
  const url = new URL(`${API}/auth`);
  url.searchParams.set('key', env.IMWEB_API_KEY);
  url.searchParams.set('secret', env.IMWEB_SECRET_KEY);
  let body;
  try {
    body = await call(url);
  } catch (e) {
    // GET이 막혀 있으면 POST(JSON)로 한 번 더 시도
    body = await call(`${API}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: env.IMWEB_API_KEY, secret: env.IMWEB_SECRET_KEY }),
    }).catch(() => { throw e; });
  }
  if (!body.access_token) throw new ImwebError('아임웹 토큰 발급 실패: access_token 없음');
  await env.KV.put(TOKEN_KEY, body.access_token, { expirationTtl: TOKEN_TTL_SEC });
  return body.access_token;
}

export function createClient(env) {
  if (!env.IMWEB_API_KEY || !env.IMWEB_SECRET_KEY) {
    throw new ImwebError('IMWEB_API_KEY / IMWEB_SECRET_KEY 비밀값이 등록되지 않았습니다');
  }
  let token = null;

  async function get(path, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    // 캐시된 토큰이 만료됐을 수 있으니 실패하면 새 토큰으로 한 번 재시도,
    // 요청 과다(-7)면 잠시 쉬었다가 다시 시도
    let renewed = false;
    for (let waits = 0; ; ) {
      token ??= renewed ? null : await env.KV.get(TOKEN_KEY);
      token ??= await issueToken(env);
      try {
        return await call(url, { headers: { 'access-token': token } });
      } catch (e) {
        if (!(e instanceof ImwebError)) throw e;
        if (e.code === RATE_LIMIT_CODE) {
          if (waits >= RATE_LIMIT_RETRIES) throw e;
          await sleep(RATE_LIMIT_WAIT_MS * ++waits);
          continue;
        }
        if (renewed) throw e;
        renewed = true;
        token = null;
      }
    }
  }

  /** 조건에 맞는 주문 전체(페이지 모두)를 가져옵니다. */
  async function listOrders(params) {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await get('/shop/orders', { ...params, offset: page, limit: PAGE_SIZE });
      const list = body.data?.list ?? [];
      all.push(...list);
      const totalPage = Number(body.data?.pagenation?.total_page ?? body.data?.pagination?.total_page ?? 1);
      if (page >= totalPage || list.length === 0) break;
    }
    return all;
  }

  /** 주문의 품목별 주문(상태·클레임 포함) */
  async function listProdOrders(orderNo) {
    const body = await get(`/shop/orders/${encodeURIComponent(orderNo)}/prod-orders`);
    const data = body.data;
    return Array.isArray(data) ? data : (data?.list ?? []);
  }

  return { get, listOrders, listProdOrders };
}

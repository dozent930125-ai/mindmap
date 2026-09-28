// 하루 매출 계산: 결제된 주문 합계 − 취소/반품 완료 금액

const REFUND_CLAIMS = ['CANCEL_COMPLETE', 'RETURN_COMPLETE'];
// Cloudflare 무료 플랜은 요청 1건당 외부 호출 50회 제한이 있어 품목 조회 횟수를 제한합니다.
const MAX_PROD_ORDER_LOOKUPS = 30;

const amountOf = (order) => Number(order.payment?.payment_amount ?? 0) || 0;
const keyOf = (order) => String(order.order_no);

function lineTotal(prodOrder) {
  return (prodOrder.items ?? []).reduce((sum, item) => {
    const price = Number(item.payment?.price ?? 0) || 0;
    const count = Number(item.payment?.count ?? 1) || 1;
    return sum + price * count;
  }, 0);
}

/**
 * 취소/반품된 주문의 환불액. 전체 취소면 결제액 전부,
 * 부분 취소면 품목 금액 비율로 결제액을 나눠 추정합니다.
 */
function refundFor(order, prodOrders) {
  const paid = amountOf(order);
  const refunded = prodOrders.filter((p) => REFUND_CLAIMS.includes(p.claim_status));
  if (prodOrders.length === 0 || refunded.length === prodOrders.length) {
    return { amount: paid, partial: false };
  }
  const total = prodOrders.reduce((s, p) => s + lineTotal(p), 0);
  const claimed = refunded.reduce((s, p) => s + lineTotal(p), 0);
  if (total <= 0) return { amount: paid, partial: true };
  return { amount: Math.round((paid * claimed) / total), partial: true };
}

/**
 * @param client createClient()가 만든 아임웹 클라이언트
 * @param range  {from, to} 유닉스 초
 */
export async function dailyRevenue(client, range) {
  const base = { order_date_from: range.from, order_date_to: range.to };

  const orders = await client.listOrders(base);
  const unpaid = new Set((await client.listOrders({ ...base, status: 'PAY_WAIT' })).map(keyOf));

  const claimed = new Set();
  for (const claim of REFUND_CLAIMS) {
    for (const o of await client.listOrders({ ...base, claim_status: claim })) claimed.add(keyOf(o));
  }

  let gross = 0;
  let refunds = 0;
  let paidCount = 0;
  let cancelledCount = 0;
  let partialCount = 0;
  let lookups = 0;

  for (const order of orders) {
    const key = keyOf(order);
    if (unpaid.has(key)) continue; // 입금 대기 등 아직 결제 안 된 주문
    const paid = amountOf(order);
    gross += paid;
    paidCount++;

    if (!claimed.has(key)) continue;
    let refund = { amount: paid, partial: false };
    if (lookups < MAX_PROD_ORDER_LOOKUPS) {
      lookups++;
      refund = refundFor(order, await client.listProdOrders(key));
    }
    refunds += Math.min(refund.amount, paid);
    if (refund.partial) partialCount++;
    else cancelledCount++;
  }

  return {
    grossRevenue: gross,
    refunds,
    revenue: gross - refunds,
    orderCount: paidCount,
    cancelledCount,
    partialCount,
  };
}

export function profitSummary({ revenue, adSpend, feeRate }) {
  const fee = Math.round(revenue * feeRate);
  return { fee, profit: revenue - fee - adSpend };
}

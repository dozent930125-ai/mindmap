import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyRevenue, profitSummary } from '../src/revenue.js';
import { kstDayRange, todayKst, isValidDate } from '../src/dates.js';

const order = (no, amount) => ({ order_no: no, payment: { payment_amount: amount } });
const prod = (claim, price, count = 1) => ({ claim_status: claim, items: [{ payment: { price, count } }] });

function fakeClient({ orders, unpaid = [], cancel = [], ret = [], prodOrders = {} }) {
  return {
    async listOrders(params) {
      if (params.status === 'PAY_WAIT') return unpaid;
      if (params.claim_status === 'CANCEL_COMPLETE') return cancel;
      if (params.claim_status === 'RETURN_COMPLETE') return ret;
      return orders;
    },
    async listProdOrders(no) { return prodOrders[no] ?? []; },
  };
}

test('결제 주문 합계에서 입금대기·전체취소·반품을 제외', async () => {
  const orders = [order(1, 10000), order(2, 20000), order(3, 30000), order(4, 40000)];
  const r = await dailyRevenue(fakeClient({
    orders,
    unpaid: [orders[0]],
    cancel: [orders[1]],
    ret: [orders[2]],
    prodOrders: { 2: [prod('CANCEL_COMPLETE', 20000)], 3: [prod('RETURN_COMPLETE', 30000)] },
  }), { from: 0, to: 1 });
  assert.equal(r.grossRevenue, 90000);
  assert.equal(r.refunds, 50000);
  assert.equal(r.revenue, 40000);
  assert.equal(r.orderCount, 3);
  assert.equal(r.cancelledCount, 2);
  assert.equal(r.partialCount, 0);
});

test('부분취소는 품목 금액 비율로 추정', async () => {
  const orders = [order(1, 27000)]; // 할인 적용된 결제액
  const r = await dailyRevenue(fakeClient({
    orders,
    cancel: [orders[0]],
    prodOrders: { 1: [prod('CANCEL_COMPLETE', 10000), prod(null, 10000, 2)] },
  }), { from: 0, to: 1 });
  assert.equal(r.refunds, 9000);
  assert.equal(r.revenue, 18000);
  assert.equal(r.partialCount, 1);
});

test('입금대기 주문이 취소돼도 이중 차감하지 않음', async () => {
  const orders = [order(1, 10000), order(2, 5000)];
  const r = await dailyRevenue(fakeClient({ orders, unpaid: [orders[0]], cancel: [orders[0]] }), { from: 0, to: 1 });
  assert.equal(r.revenue, 5000);
  assert.equal(r.refunds, 0);
});

test('수익 = 매출 − 2.25% − 광고비', () => {
  assert.deepEqual(profitSummary({ revenue: 1_250_000, adSpend: 350_000, feeRate: 0.0225 }), { fee: 28125, profit: 871875 });
});

test('KST 날짜 범위', () => {
  // 2026-09-28 10:00 KST = 01:00 UTC
  const now = Date.UTC(2026, 8, 28, 1, 0, 0);
  assert.equal(todayKst(now), '2026-09-28');
  const today = kstDayRange('2026-09-28', now);
  assert.equal(today.from, Date.UTC(2026, 8, 27, 15) / 1000);
  assert.equal(today.to, now / 1000);
  assert.equal(today.isToday, true);
  const past = kstDayRange('2026-09-27', now);
  assert.equal(past.to - past.from, 86399);
  assert.equal(todayKst(Date.UTC(2026, 8, 28, 15, 0, 0)), '2026-09-29');
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('x'));
});

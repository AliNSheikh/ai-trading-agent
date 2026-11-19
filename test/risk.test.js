import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFill, fillSummary } from '../lib/orders.js';
import { evaluateRisk } from '../lib/risk.js';
import { defaults, periods } from '../lib/settings.js';

const now = Date.UTC(2026, 0, 11, 7);
const { day, month } = periods(now);
const market = { price: 100, closedAt: new Date(now - 1000).toISOString() };
const rules = { step: 0.01, minQty: 0.01, maxQty: 100, minimum: 5, baseAsset: 'BTC' };
const wallet = {
  canTrade: true, balances: [{ asset: 'USDT', free: '100' }, { asset: 'BTC', free: '1' }],
  commissionRates: { taker: '0.001', buyer: '0' }
};

function fixture(settings = defaults) {
  return {
    state: { settings, stopped: false, realized: 0, positions: {}, days: {}, months: {}, pending: null },
    symbol: 'BTCUSDT', decision: { side: 'BUY' }, market, rules, wallet, verified: true, now
  };
}

test('default 0.5% full-loss risk rejects a trade below the exchange minimum', () => {
  assert.match(evaluateRisk(fixture()).reason, /minimum order size/);
});

test('entries respect risk budgets, fill caps, stale prices, pending orders and emergency stop', () => {
  const input = fixture({
    ...defaults, dailyLoss: { mode: 'usd', value: 10 }, riskPerTrade: { mode: 'usd', value: 8 }
  });
  assert.equal(evaluateRisk(input).amount, '7.92');
  input.state.days[day] = { volume: 16, trades: 0, loss: 0 };
  assert.equal(evaluateRisk(input).accepted, false);
  input.state.days[day] = { volume: 0, trades: 3, loss: 0 };
  assert.match(evaluateRisk(input).reason, /Daily new trade limit/);
  input.state.days[day] = { volume: 0, trades: 0, loss: 7 };
  assert.equal(evaluateRisk(input).accepted, false);
  input.state.days[day].loss = 0;
  input.state.months[month] = { loss: 8 };
  assert.equal(evaluateRisk(input).accepted, false);
  input.state.months[month].loss = 0;
  input.state.positions.ETHUSDT = { cost: 6 };
  assert.equal(evaluateRisk(input).accepted, false);
  input.state.positions.SOLUSDT = { cost: 1 };
  assert.match(evaluateRisk(input).reason, /Open position limit/);
  input.state.pending = { clientId: 'retained' };
  assert.match(evaluateRisk(input).reason, /reconciliation/);
  input.state.stopped = true;
  assert.match(evaluateRisk(input).reason, /stopped/);
  assert.match(evaluateRisk({ ...fixture(), market: { ...market, closedAt: '2025-01-01' } }).reason, /stale/);
});

test('risk-reducing exit stays within quantity and increments filled volume', () => {
  const input = fixture();
  input.state.positions.BTCUSDT = { entryId: 'entry', time: '2026-01-11', price: 100, quantity: 0.10,
    cost: 10, fees: { BTC: 0.0001 }, strategy: 'first' };
  input.state.days[day] = { volume: 20, trades: 3, loss: 0 };
  input.decision.side = 'SELL';
  assert.equal(evaluateRisk(input).amount, '0.10000000');
  const pending = { symbol: 'BTCUSDT', clientId: 'exit', side: 'SELL', strategy: 'second', baseAsset: 'BTC' };
  const order = { symbol: 'BTCUSDT', clientOrderId: 'exit', orderId: 1, side: 'SELL', type: 'MARKET',
    status: 'FILLED', executedQty: '0.10', cummulativeQuoteQty: '9', updateTime: now };
  const fill = { id: 2, orderId: 1, symbol: 'BTCUSDT', qty: '0.10', quoteQty: '9', commission: '0.01', commissionAsset: 'USDT' };
  assert.throws(() => fillSummary(order, [], pending), /incomplete/);
  assert.throws(() => fillSummary(order, [fill, fill], pending), /duplicate/);
  assert.throws(() => fillSummary(order, [{ ...fill, commissionAsset: 'BNB' }], pending), /fee asset/);
  const resolved = { pending, fill: fillSummary(order, [fill], pending) };
  input.state.pending = pending;
  const trade = applyFill(input.state, resolved);
  assert.equal(trade.entryPrice, 100);
  assert.equal(trade.entryStrategy, 'first');
  assert.ok(Math.abs(trade.netProfit - (-1.01)) < 1e-9);
  assert.equal(input.state.days[day].volume, 29);
  assert.equal(input.state.positions.BTCUSDT, undefined);
  assert.throws(() => applyFill(input.state, resolved), /conflict/);
});

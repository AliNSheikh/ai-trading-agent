import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEnginePending, closedOutcomes, dispatchEntry, reconcileBook, settlePending } from '../lib/executor.js';
import { fingerprint } from '../lib/orders.js';
import { getState } from '../lib/store.js';
import { install, intent } from './support/fake-exchange.js';

const costs = { slip: 0.0005, costMultiple: 3.5 };
const open = async (symbol, over) => {
  const r = await dispatchEntry({ leaseId: 'L1', intent: intent(symbol, over), fingerprint: fingerprint(), costs });
  assert.equal(r.accepted, true, JSON.stringify(r));
  const s = await settlePending('L1');
  assert.equal(s.status, 'opened', JSON.stringify(s));
  return r;
};

test('two trades run concurrently: the dispatch slot frees as soon as the entry fills', async t => {
  const x = install(t);
  const a = await open('BTCUSDT'), b = await open('ETHUSDT');
  const s = await getState();
  assert.equal(s.pending, null);
  assert.deepEqual(Object.keys(s.book).sort(), [a.listId, b.listId].sort());
  const day = Object.values(s.days)[0];
  assert.equal(day.entries, 2); assert.equal(day.orders, 2);
  const trade = s.book[a.listId];
  assert.ok(trade.plan.stopPrice < trade.entryPrice && trade.plan.targetPrice > trade.entryPrice && trade.cost > 15 && trade.cost <= 250);
  assert.ok(x.calls.filter(c => c === 'POST /api/v3/orderList/opoco').length === 2);
  assert.ok(!x.calls.some(c => c === 'POST /api/v3/order'), 'entries must use native protected order lists only');
});
test('limits: one trade per pair, concurrency cap, stopped state and exploration cap', async t => {
  install(t);
  await open('BTCUSDT');
  const dup = await dispatchEntry({ leaseId: 'L1', intent: intent('BTCUSDT', { signalAt: 5 }), fingerprint: fingerprint(), costs });
  assert.equal(dup.code, 'duplicate-symbol');
  const fam = await dispatchEntry({ leaseId: 'L1', intent: intent('ETHUSDT'), fingerprint: fingerprint(), costs });
  assert.equal(fam.accepted, true); await settlePending('L1');
  const cap = await dispatchEntry({ leaseId: 'L1', intent: intent('SOLUSDT'), fingerprint: fingerprint(), costs });
  assert.equal(cap.code, 'family-cap', 'two open trades from one family is the default maximum');
  await (await import('../lib/store.js')).changeState(s => { s.stopped = true; });
  const stopped = await dispatchEntry({ leaseId: 'L1', intent: intent('DOGEUSDT', { family: 'breakout' }), fingerprint: fingerprint(), costs });
  assert.equal(stopped.code, 'stopped');
});
test('an exchange-side target or stop settles exactly once and reports risk-multiple outcomes', async t => {
  const x = install(t);
  const a = await open('BTCUSDT'), b = await open('ETHUSDT', { family: 'breakout', strategy: 'donchian-breakout' });
  x.hit(a.listId, 'target'); x.hit(b.listId, 'stop');
  const results = await reconcileBook('L1');
  const outcomes = closedOutcomes(results);
  assert.equal(outcomes.length, 2);
  const win = outcomes.find(o => o.symbol === 'BTCUSDT'), loss = outcomes.find(o => o.symbol === 'ETHUSDT');
  assert.equal(win.exit, 'target'); assert.ok(win.r > 1 && win.netUsd > 0);
  assert.equal(loss.exit, 'stop'); assert.ok(loss.r < 0 && loss.r > -2);
  const s = await getState();
  assert.deepEqual(s.book, {}); assert.equal(s.performance.closed, 2); assert.equal(s.performance.wins, 1);
  assert.ok(Math.abs(s.realized - (win.netUsd + loss.netUsd)) < 1e-9);
  assert.equal(closedOutcomes(await reconcileBook('L1')).length, 0, 'no double settlement');
  assert.equal(Object.keys(s.strategyPerformance).length, 2);
});
test('time-stop cancels both exit legs, sells at market once, and settles with fees', async t => {
  const x = install(t);
  const a = await open('BTCUSDT');
  await (await import('../lib/store.js')).changeState(s => { s.book[a.listId].deadline = Date.now() - 1000; });
  const outcomes = closedOutcomes(await reconcileBook('L1'));
  assert.equal(outcomes.length, 1); assert.equal(outcomes[0].exit, 'time-stop');
  const seq = x.calls.filter(c => c.startsWith('DELETE') || c === 'POST /api/v3/order');
  assert.deepEqual(seq, ['DELETE /api/v3/orderList', 'POST /api/v3/order'], 'cancel strictly before the single market sell');
  const s = await getState();
  assert.deepEqual(s.book, {}); assert.ok(Number.isFinite(s.realized) && s.performance.closed === 1);
  assert.ok(Math.abs(outcomes[0].netUsd) < 2, 'a ~0.05% price move cannot produce a large result: ' + outcomes[0].netUsd);
  assert.equal(closedOutcomes(await reconcileBook('L1')).length, 0);
  assert.equal(x.calls.filter(c => c === 'POST /api/v3/order').length, 1);
});
test('an ambiguous market-sell response is reconciled by client ID and never retransmitted', async t => {
  const x = install(t);
  const a = await open('BTCUSDT');
  await (await import('../lib/store.js')).changeState(s => { s.book[a.listId].deadline = Date.now() - 1000; });
  x.failSellPost = true;
  const first = await reconcileBook('L1');
  assert.equal(closedOutcomes(first).length, 1, 'order found by client ID right after the timeout');
  assert.equal(x.calls.filter(c => c === 'POST /api/v3/order').length, 1);
});
test('a fill-or-kill entry that expires leaves no position and frees the slot', async t => {
  const x = install(t); x.expireEntry = true;
  const r = await dispatchEntry({ leaseId: 'L1', intent: intent('BTCUSDT'), fingerprint: fingerprint(), costs });
  assert.equal(r.accepted, true);
  const s = await settlePending('L1');
  assert.equal(s.status, 'unfilled');
  const state = await getState();
  assert.equal(state.pending, null); assert.deepEqual(state.book, {});
  assert.equal(Object.values(state.days)[0].unfilled, 1);
});
test('daily entry and order caps are enforced including reserved exits', async t => {
  install(t, {});
  const st = await getState();
  const { changeState } = await import('../lib/store.js');
  await changeState(s => { s.settings.maxTrades = 4; s.settings.engine.maxPerFamily = 5; s.settings.engine.maxConcurrent = 5; s.settings.maxOpenPositions = 5; });
  await open('BTCUSDT'); await open('ETHUSDT');
  const third = await dispatchEntry({ leaseId: 'L1', intent: intent('SOLUSDT'), fingerprint: fingerprint(), costs });
  assert.equal(third.code, 'daily-cap');
  void st; void applyEnginePending;
});

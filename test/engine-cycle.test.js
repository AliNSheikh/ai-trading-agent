import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observe } from '../lib/allocator.js';
import { newLearning } from '../lib/engine.js';
import { runAnalysis, runExecution, sentimentMultiplier } from '../lib/engine-cycle.js';
import { strategies } from '../lib/strategies.js';
import { getState } from '../lib/store.js';
import { install } from './support/fake-exchange.js';
import { symbols, synth } from './support/synth.js';

// Learner pre-seeded as if every strategy variant had proven an edge, so intents are 'live' and sized.
function provenLearning() {
  const L = newLearning(), now = Date.now();
  for (const st of strategies) for (const v of st.variants) for (let i = 0; i < 40; i++)
    observe(L, { strategy: st.id, variant: v.id, symbol: 'BTCUSDT', regime: 'trend-up', r: i % 3 ? 1.5 : -1 }, now);
  return L;
}
const sliceFeed = (feed, cut) => Object.fromEntries(Object.entries(feed).map(([s, v]) => [s, v.slice(0, cut)]));

test('full chain: analysis finds signals, execution opens several protected trades at once, learning records them', async t => {
  const x = install(t, { price: 100 });
  const state0 = await getState();
  const pairsOn = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT'];
  let found = null;
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const feed = synth(symbols, 1500, seed, undefined, 100);
    for (let cut = 1500; cut > 1000 && !found; cut--) {
      const sliced = sliceFeed(feed, cut), now = sliced.BTCUSDT[cut - 1][6] + 60000;
      const L = provenLearning();
      const out = runAnalysis({ feed: sliced, learning: L, state: { ...state0, book: {} }, now });
      if (out.intents.length >= 2) found = { out, L, now, sliced };
    }
    if (found) break;
  }
  assert.ok(found, 'expected at least one cycle with two concurrent opportunities');
  const { out, L, now } = found;
  for (const i of out.intents) assert.ok(pairsOn.includes(i.symbol), 'intents only on enabled pairs: ' + i.symbol);
  assert.ok(new Set(out.intents.map(i => i.symbol)).size === out.intents.length, 'one intent per pair');
  x.price = 100;
  for (const i of out.intents) i.entry = 100;                // fake exchange quotes a single price
  const record = { decisions: [], trades: [] };
  const run = await runExecution({ id: 'L1', record, state: await getState(), engineOut: out, learning: L, sentiment: 'neutral', now });
  assert.ok(run.dispatched >= 1 && run.dispatched <= 2, 'per-cycle cap is 2, got ' + run.dispatched);
  const s = await getState();
  assert.equal(Object.keys(s.book).length, run.dispatched);
  assert.equal(s.pending, null);
  assert.ok(record.decisions.every(d => d.risk && typeof d.risk.accepted === 'boolean'));
  for (const trade of Object.values(s.book)) assert.ok(trade.plan.stopPrice < trade.entryPrice && trade.plan.expectedWorstUsd <= 7.5 + 1e-9, 'risk bounded: ' + trade.plan.expectedWorstUsd);
  // Exits on the exchange feed learning.
  const [first] = Object.values(s.book);
  x.hit(first.listId, 'target');
  const run2 = await runExecution({ id: 'L1', record, state: await getState(), engineOut: { intents: [] }, learning: L, sentiment: 'neutral', now: now + 900000 });
  assert.equal(run2.closed, 1); assert.equal(L.live.n, 1); assert.equal(record.trades.length, 1);
  assert.equal(Object.keys((await getState()).book).length, run.dispatched - 1);
});
test('with execution disabled the engine records signals as paper-only decisions and sends no order', async t => {
  const x = install(t); process.env.DEMO_ENGINE_EXECUTION = 'false';
  const intents = [{ symbol: 'BTCUSDT', strategy: 'pullback-trend', variant: 'a', family: 'trend', regime: 'trend-up', mode: 'live', riskMult: 1, score: 1, entry: 100, stopPct: .012, targetPct: .03, maxBars: 8, reason: 'r', features: {}, shadowId: 's', signalAt: Date.now(), estimate: .2 }];
  const record = { decisions: [], trades: [] }, L = newLearning();
  const run = await runExecution({ id: 'L1', record, state: await getState(), engineOut: { intents }, learning: L, sentiment: null, now: Date.now() });
  assert.equal(run.dispatched, 0); assert.equal(record.decisions[0].risk.code, 'engine-shadow');
  assert.ok(!x.calls.some(c => c.includes('orderList')));
});
test('AI sentiment can only trim risk and its absence never blocks trading', () => {
  assert.equal(sentimentMultiplier('negative'), 0.5); assert.equal(sentimentMultiplier('mixed'), 0.75);
  assert.equal(sentimentMultiplier('positive'), 1); assert.equal(sentimentMultiplier(null), 0.85);
  for (const s of ['positive', 'neutral', 'mixed', 'negative', null, 'weird']) assert.ok(sentimentMultiplier(s) <= 1 && sentimentMultiplier(s) > 0);
});

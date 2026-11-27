import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adx, aggregate, atr, bollinger, ema, rsi, toBars } from '../lib/indicators.js';
import { buildSeries } from '../lib/series.js';
import { stepShadow, resolveShadows } from '../lib/shadow.js';
import { decide, estimate, observe, rng, leaderboard } from '../lib/allocator.js';
import { adapt, classify, recordOutcome } from '../lib/postmortem.js';
import { analyze, newLearning, replay, summarizeOutcomes, recordLive } from '../lib/engine.js';
import { defaultGuards } from '../lib/strategies.js';
import { symbols, synth } from './support/synth.js';

const feed = synth(symbols, 1500, 'engine-test');
const bars = toBars(feed.BTCUSDT);

test('indicators are causal: appending future bars never changes past values', () => {
  const cut = 900, a = bars.slice(0, cut), c = a.map(b => b.c), cf = bars.map(b => b.c);
  const same = (x, y) => { for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i])) assert.ok(Math.abs(x[i] - y[i]) < 1e-9, 'diverged at ' + i); };
  same(ema(c, 20), ema(cf, 20)); same(rsi(c, 14), rsi(cf, 14)); same(atr(a, 14), atr(bars, 14)); same(adx(a, 14), adx(bars, 14));
  same(bollinger(c).width, bollinger(cf).width);
  const s1 = buildSeries(a), s2 = buildSeries(bars);
  for (let i = 300; i < cut; i += 37) { assert.equal(s1.h1At[i], s2.h1At[i]); assert.ok(Math.abs(s1.h1adx[s1.h1At[i]] - s2.h1adx[s2.h1At[i]]) < 1e-9); }
});
test('aggregation keeps only complete aligned hours and never mixes partial bars', () => {
  const h = aggregate(bars.slice(3), 60);
  assert.ok(h.length > 300 && h.every(b => b.n === 4 && b.t % 3600000 === 0 && b.ct === b.t + 3599999));
});
test('shadow simulator: stop beats target in the same bar, gaps fill at the open, time exits at close', () => {
  const mk = (o, h, l, c, t) => ({ t, o, h, l, c, v: 1, ct: t + 899999 });
  const sh = { signalAt: 0, stopPct: 0.01, targetPct: 0.02, maxBars: 3, roundTrip: 0.003 };
  let r = stepShadow(sh, [mk(100, 100, 100, 100, 0), mk(100, 103, 98.9, 100, 900000)]);
  assert.equal(r.exit, 'stop'); assert.ok(Math.abs(r.net - (-0.01 - 0.003)) < 1e-9); assert.ok(Math.abs(r.r + 1.3) < 1e-9);
  r = stepShadow(sh, [mk(100, 100, 100, 100, 0), mk(100, 102.5, 99.5, 102, 900000)]);
  assert.equal(r.exit, 'target'); assert.ok(Math.abs(r.r - (0.02 - 0.003) / 0.01) < 1e-9);
  r = stepShadow(sh, [mk(100, 100, 100, 100, 0), mk(100, 100.2, 99.8, 100, 900000), mk(97, 98, 96, 97, 1800000)]);
  assert.equal(r.exit, 'stop'); assert.equal(r.exitPrice, 97);
  r = stepShadow(sh, [mk(100, 100, 100, 100, 0), mk(100, 100.5, 99.5, 100.2, 900000), mk(100, 100.5, 99.5, 100.1, 1800000), mk(100, 100.4, 99.6, 100.3, 2700000)]);
  assert.equal(r.exit, 'time'); assert.equal(r.bars, 3);
  assert.equal(stepShadow(sh, [mk(100, 100, 100, 100, 0), mk(100, 100.5, 99.5, 100, 900000)]), null);
  assert.deepEqual(resolveShadows([{ ...sh, symbol: 'X' }], {}).resolved, []);
});
test('allocator: validated edge goes live, proven loser is disabled, unknowns explore at minimum size', () => {
  const L = newLearning(), now = Date.now(), r = rng('t');
  const good = { strategy: 's', variant: 'a', symbol: 'AAA', regime: 'trend-up' }, bad = { strategy: 's', variant: 'b', symbol: 'AAA', regime: 'trend-up' };
  for (let i = 0; i < 60; i++) { observe(L, { ...good, r: i % 3 === 0 ? -1.1 : 1.6 }, now); observe(L, { ...bad, r: i % 4 === 0 ? 1.5 : -1.2 }, now); }
  const g = estimate(L, good, now), b = estimate(L, bad, now);
  assert.equal(decide(g, r).mode, 'live'); assert.ok(decide(g, r).riskMult >= 0.5 && decide(g, r).riskMult <= 1.5);
  assert.equal(decide(b, r).mode, 'disabled');
  const unknown = estimate(L, { strategy: 'z', variant: 'a', symbol: 'Q', regime: 'x' }, now);
  assert.ok(unknown.est < 0 && ['probe', 'shadow'].includes(decide(unknown, rng('u')).mode));
  assert.deepEqual(decide(unknown, rng('same')), decide(unknown, rng('same')));
  assert.equal(leaderboard(L, now)[0].variant, 'a');
});
test('allocator evidence decays so a once-good strategy can lose its live status', () => {
  const L = newLearning(), t0 = Date.now() - 90 * 86400000, o = { strategy: 's', variant: 'a', symbol: 'A', regime: 'x' };
  for (let i = 0; i < 40; i++) observe(L, { ...o, r: i % 3 ? 1.5 : -1 }, t0);
  assert.equal(decide(estimate(L, o, t0), rng('a')).mode, 'live');
  assert.notEqual(decide(estimate(L, o, Date.now()), rng('a')).mode, 'live');
});
test('post-mortem classifies losses and adapts one bounded guard, then reverts a harmful change', () => {
  assert.deepEqual(classify({ r: 0.5 }), []);
  assert.ok(classify({ r: -1, exit: 'stop', bars: 2, btcMove: -0.01, features: { extAtr: 1.3 }, roundTrip: 0.003, stopPct: 0.01 }).includes('market-beta'));
  const L = newLearning(), now = Date.now();
  for (let i = 0; i < 30; i++) recordOutcome(L, { strategy: 's', variant: 'a', family: 'trend', r: -1, tags: ['market-beta'], exit: 'stop' }, now);
  const log = adapt(L, now);
  assert.equal(L.guards.btcDropPct, defaultGuards.btcDropPct - 0.25); assert.equal(L.changes.at(-1).status, 'trial'); assert.ok(log.length);
  assert.equal(adapt(L, now).length, 0, 'only one experiment at a time');
  for (let i = 0; i < 30; i++) recordOutcome(L, { strategy: 's', variant: 'a', family: 'trend', r: -2, tags: ['normal-loss'], exit: 'stop' }, now);
  adapt(L, now);
  assert.equal(L.guards.btcDropPct, defaultGuards.btcDropPct); assert.equal(L.changes.at(-1).status, 'reverted');
  for (const k of Object.keys(L.guards)) assert.ok(Number.isFinite(L.guards[k]));
});
test('engine replay is deterministic and finds trades across several strategies without look-ahead', () => {
  const a = replay(feed), b = replay(feed);
  assert.deepEqual(summarizeOutcomes(a), summarizeOutcomes(b));
  assert.ok(a.length > 30, 'expected trades, got ' + a.length);
  assert.ok(new Set(a.map(x => x.strategy)).size >= 3, 'multiple strategy families should fire');
  for (const x of a) { assert.ok(Number.isFinite(x.r) && x.bars >= 1 && x.exitAt > x.signalAt); }
  const shorter = replay(Object.fromEntries(Object.entries(feed).map(([k, v]) => [k, v.slice(0, 1200)])));
  const prefix = a.filter(x => x.exitAt <= feed.BTCUSDT[1199][6]).map(x => x.id.split(':').slice(0, 4).join(':'));
  const fromShort = shorter.map(x => x.id.split(':').slice(0, 4).join(':'));
  const missing = fromShort.filter(id => !prefix.includes(id));
  assert.ok(missing.length / Math.max(1, fromShort.length) < 0.02, 'signals depended on future bars');
});
test('analyze learns from resolved paper trades, stays bounded, and exposes intents only for qualified arms', () => {
  const L = newLearning(), step = 900000;
  const end = feed.BTCUSDT[1499][6] + 1;
  let intents = 0;
  for (let k = 300; k >= 0; k--) {
    const cut = 1500 - k, sliced = Object.fromEntries(Object.entries(feed).map(([s, v]) => [s, v.slice(0, cut)]));
    const out = analyze({ feed: sliced, learning: L, now: sliced.BTCUSDT[cut - 1][6] + 60000 });
    intents += out.intents.length;
    for (const i of out.intents) assert.ok(['live', 'probe'].includes(i.mode) && i.stopPct > 0.004 && i.targetPct > i.stopPct && i.riskMult > 0);
  }
  assert.ok(Object.keys(L.arms).length > 10 && L.open.length <= 400 && L.recent.length > 5);
  assert.ok(JSON.stringify(L).length < 400000, 'learning state must fit the 700 KB journal limit');
  recordLive(L, { shadowId: 'a', r: -0.3, net: -0.004 });
  assert.equal(L.live.n, 1);
  void intents; void end; void step;
});
test('stale candles never produce new entries', () => {
  const L = newLearning();
  const out = analyze({ feed, learning: L, now: feed.BTCUSDT[1499][6] + 3 * 3600000 });
  assert.equal(out.intents.length, 0); assert.equal(out.diagnostics.fresh, 0);
});

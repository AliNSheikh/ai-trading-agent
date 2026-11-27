import { adapt, classify, recordOutcome } from './postmortem.js';
import { decide, estimate, leaderboard, observe, rng } from './allocator.js';
import { toBars, valid } from './indicators.js';
import { buildSeries, marketState, pairState } from './series.js';
import { costDefaults, newShadow, resolveShadows, roundTrip, stepShadow } from './shadow.js';
import { crossSection, defaultGuards, evaluateAll } from './strategies.js';

export const engineVersion = 'multi-strategy-v1';
const BAR = 900000;

export const newLearning = () => ({ v: 1, arms: {}, open: [], last: {}, guards: { ...defaultGuards }, recent: [], changes: [],
  costs: { slip: costDefaults.slip, samples: [] }, live: { n: 0, sumR: 0 }, liveIds: {}, journal: [], counters: {}, created: Date.now() });

const dayKey = t => new Date(t).toISOString().slice(0, 10);
function bump(learning, now, field, n = 1) {
  const d = learning.counters[dayKey(now)] ??= {};
  d[field] = (d[field] ?? 0) + n;
  for (const k of Object.keys(learning.counters).sort().slice(0, -14)) delete learning.counters[k];
}
function moveOver(bars, from, to) {
  if (!bars) return NaN;
  const a = bars.findLast(b => b.ct <= from), b = bars.findLast(b => b.ct <= to);
  return a && b ? b.c / a.c - 1 : NaN;
}
function features(ps, signal) {
  return { extAtr: +((ps.price - ps.ema20) / ps.atr15).toFixed(2), relVol: +(ps.relVol ?? 0).toFixed(2), atr1hPct: +ps.atr1hPct.toFixed(5),
    rsi: +ps.rsi14.toFixed(1), adx: +(ps.h1.adx ?? 0).toFixed(1), rank: signal.rank ?? null };
}
export function prepare(feed) {
  const bars = {}, series = {};
  for (const [symbol, rows] of Object.entries(feed)) {
    try {
      const b = toBars(rows);
      if (b.length >= 260 && valid(b)) { bars[symbol] = b; series[symbol] = buildSeries(b); }
    } catch { /* unusable pair is skipped for this cycle */ }
  }
  return { bars, series };
}


// Evaluate every closed candle since the last processed one (shadow only), so learning does not depend on cron
// precision. First run warm-starts from the candles already fetched. Live entries still require a fresh candle.
function catchUp({ series, learning, costs, now, first }) {
  const symbols = Object.keys(series), btc = series.BTCUSDT;
  if (!symbols.length) return 0;
  const clock = (btc ?? series[symbols[0]]).bars;
  const newest = clock.at(-1).ct;
  const from = learning.cursorCt ?? newest - 200 * BAR;
  const steps = clock.filter(b => b.ct > from && b.ct < newest && b.ct <= now).map(b => b.ct).slice(first ? -200 : -48);
  const maps = Object.fromEntries(symbols.map(s => [s, new Map(series[s].bars.map((b, i) => [b.ct, i]))]));
  let opened = 0;
  for (const ct of steps) {
    const at = {};
    for (const s of symbols) { const i = maps[s].get(ct); if (i != null && i >= 260) at[s] = i; }
    const market = btc && at.BTCUSDT != null ? marketState(btc, at.BTCUSDT, null, learning.guards.btcDropPct) : { risk: 'neutral', ret1h: 0, ret4h: 0, ret24h: 0 };
    const cross = crossSection(series, at);
    for (const [symbol, i] of Object.entries(at)) {
      const s = series[symbol], ps = pairState(s, i);
      for (const sg of evaluateAll({ symbol, s, ps, market, cross: cross[symbol] }, costs, learning.guards)) {
        if (!sg.costGate) continue;
        const key = sg.strategy + ':' + sg.variant + ':' + symbol;
        if (learning.last[key] > ct - Math.max(learning.guards.coolBars, sg.maxBars / 2) * BAR) continue;
        sg.features = features(ps, sg);
        learning.open.push(newShadow(sg, ct)); learning.last[key] = ct; opened++;
      }
    }
  }
  return opened;
}

// One engine step on the newest closed candle of every pair. Mutates `learning`.
export function analyze({ feed, learning, blocked = new Set(), now = Date.now(), maxIntents = 3 }) {
  const { bars, series } = prepare(feed);
  const symbols = Object.keys(series);
  const costs = { ...costDefaults, slip: learning.costs.slip };
  const diag = { pairs: symbols.length, fresh: 0, signals: 0, costBlocked: 0, shadowsOpened: 0, resolved: 0, byMode: {} };

  // 0. Catch up on candles missed between runs (cron jitter, outages) as paper trades only.
  const first = learning.cursorCt == null;
  diag.caughtUp = symbols.length ? catchUp({ series, learning, costs, now, first }) : 0;
  learning.open = learning.open.slice(-1500);
  bump(learning, now, 'caughtUp', diag.caughtUp);

  // 1. Resolve paper trades, learn from them, and classify the losses.
  const { remaining, resolved } = resolveShadows(learning.open, bars);
  learning.open = remaining;
  for (const r of resolved) {
    observe(learning, r, r.exitAt);
    const btcMove = moveOver(bars.BTCUSDT, r.signalAt, r.exitAt);
    const tags = classify({ ...r, btcMove });
    recordOutcome(learning, { ...r, tags }, r.exitAt);
    const live = learning.liveIds[r.id];
    if (live) { learning.costs.samples.push(r.net - live.net); delete learning.liveIds[r.id]; }
  }
  if (learning.costs.samples.length >= 10) {
    const s = learning.costs.samples.splice(0), m = s.reduce((a, b) => a + b, 0) / s.length;
    learning.costs.slip = Math.max(0.0003, Math.min(0.003, learning.costs.slip + 0.5 * m / 2));
    learning.journal.push({ at: now, note: 'Execution-cost calibration: live fills trailed paper fills by ' + (m * 100).toFixed(3) + '%; slippage assumption is now ' + (learning.costs.slip * 100).toFixed(3) + '% per side' });
  }
  diag.resolved = resolved.length;
  bump(learning, now, 'resolved', resolved.length);
  for (const note of resolved.length ? adapt(learning, now) : []) learning.journal.push({ at: now, note });
  learning.journal = learning.journal.slice(-40);

  // 2. Market context and cross-section.
  const btc = series.BTCUSDT;
  const idx = Object.fromEntries(symbols.map(s => [s, series[s].bars.length - 1]));
  let up = 0;
  for (const s of symbols) up += pairState(series[s], idx[s]).h1.trend === 'up';
  const breadth = symbols.length ? up / symbols.length : null;
  const market = btc ? marketState(btc, idx.BTCUSDT, breadth, learning.guards.btcDropPct) : { risk: 'neutral', ret1h: 0, ret4h: 0, ret24h: 0, breadth };
  const cross = crossSection(series, idx);

  // 3. Evaluate every strategy variant on every fresh pair.
  const candidates = [], summary = [];
  for (const symbol of symbols) {
    const s = series[symbol], i = idx[symbol], b = s.bars[i];
    if (!(b.ct <= now && now - b.ct < 16 * 60000)) continue;   // stale newest candle: no live entry (it is covered by catch-up next run)
    diag.fresh++;
    const ps = pairState(s, i);
    const signals = evaluateAll({ symbol, s, ps, market, cross: cross[symbol] }, costs, learning.guards);
    for (const sg of signals) {
      sg.features = features(ps, sg);
      diag.signals++;
      if (!sg.costGate) { diag.costBlocked++; continue; }
      const key = sg.strategy + ':' + sg.variant + ':' + symbol;
      const cooling = learning.last[key] > b.ct - learning.guards.coolBars * BAR;
      const trackedOpen = learning.open.some(o => o.symbol === symbol && o.strategy === sg.strategy && o.variant === sg.variant);
      let shadowId = null;
      if (!cooling && !trackedOpen) {
        const sh = newShadow(sg, b.ct);
        learning.open.push(sh); learning.last[key] = b.ct; shadowId = sh.id; diag.shadowsOpened++;
      }
      const e = estimate(learning, sg, now);
      const d = decide(e, rng(b.ct + ':' + key));
      diag.byMode[d.mode] = (diag.byMode[d.mode] ?? 0) + 1;
      summary.push({ symbol, strategy: sg.strategy, variant: sg.variant, regime: sg.regime, mode: d.mode, expectancyR: +e.est.toFixed(2), n: Math.round(e.nVariant), fresh: Boolean(shadowId) });
      if (shadowId && ['live', 'probe'].includes(d.mode) && !blocked.has(symbol)) {
        candidates.push({ symbol, strategy: sg.strategy, variant: sg.variant, family: sg.family, regime: sg.regime, market: sg.market, mode: d.mode,
          riskMult: d.riskMult, score: d.score, entry: sg.entry, stopPct: sg.stopPct, targetPct: sg.targetPct, maxBars: sg.maxBars,
          roundTrip: sg.roundTrip, reason: sg.reason + ' · ' + d.reason, features: sg.features, shadowId, signalAt: b.ct, estimate: +e.est.toFixed(3) });
      }
    }
  }
  learning.open = learning.open.slice(-400);
  if (symbols.length) {
    // Advance past the newest candle only if it was actually evaluated; a stale one is picked up by the next run's catch-up.
    const clockBars = (series.BTCUSDT ?? series[symbols[0]]).bars;
    const evaluated = clockBars.at(-1).ct <= now && now - clockBars.at(-1).ct < 16 * 60000;
    const cursor = evaluated ? clockBars.at(-1).ct : clockBars.at(-2).ct;
    learning.cursorCt = Math.max(learning.cursorCt ?? 0, cursor);
  }
  for (const [k, t] of Object.entries(learning.last)) if (now - t > 3 * 86400000) delete learning.last[k];
  bump(learning, now, 'signals', diag.signals); bump(learning, now, 'shadowsOpened', diag.shadowsOpened);

  // 4. One intent per symbol (best score), live before probe, ranked by posterior score.
  const best = new Map();
  for (const c of candidates) { const p = best.get(c.symbol); if (!p || c.score > p.score) best.set(c.symbol, c); }
  const intents = [...best.values()].sort((a, b) => (b.mode === 'live') - (a.mode === 'live') || b.score - a.score).slice(0, maxIntents);
  return { intents, signals: summary, resolved, market, guards: { ...learning.guards }, diagnostics: diag, leaderboard: leaderboard(learning, now) };
}

// Called when a live trade closes so execution quality is compared with the paper twin.
export function recordLive(learning, trade, now = Date.now()) {
  learning.live.n++; learning.live.sumR += trade.r;
  if (trade.shadowId) learning.liveIds[trade.shadowId] = { net: trade.net, r: trade.r };
  const keys = Object.keys(learning.liveIds);
  if (keys.length > 60) delete learning.liveIds[keys[0]];
  bump(learning, now, 'live');
}

// Walk-forward replay over history with the exact live code path. Used for warm-start and for scripts/backtest.js.
export function replay(feed, { costs = costDefaults, guards = defaultGuards, warmup = 250 } = {}) {
  const { bars, series } = prepare(feed);
  const symbols = Object.keys(series), outcomes = [];
  if (!symbols.length) return outcomes;
  const clock = (series.BTCUSDT ?? series[symbols[0]]).bars.map(b => b.ct);
  const index = Object.fromEntries(symbols.map(s => [s, new Map(series[s].bars.map((b, i) => [b.ct, i]))]));
  const lastSignal = {};
  const c = { ...costs };
  for (let step = warmup; step < clock.length; step++) {
    const ct = clock[step], at = {};
    for (const s of symbols) { const i = index[s].get(ct); if (i != null && i >= warmup) at[s] = i; }
    const btc = series.BTCUSDT, market = btc && at.BTCUSDT != null ? marketState(btc, at.BTCUSDT, null, guards.btcDropPct) : { risk: 'neutral' };
    const cross = crossSection(series, at);
    for (const [symbol, i] of Object.entries(at)) {
      const s = series[symbol], ps = pairState(s, i);
      for (const sg of evaluateAll({ symbol, s, ps, market, cross: cross[symbol] }, c, guards)) {
        if (!sg.costGate) continue;
        const key = sg.strategy + ':' + sg.variant + ':' + symbol;
        if (lastSignal[key] > ct - Math.max(guards.coolBars, sg.maxBars / 2) * BAR) continue;
        lastSignal[key] = ct;
        const sh = newShadow(sg, ct, { features: features(ps, sg) });
        const out = stepShadow(sh, s.bars.slice(i + 1, i + 3 + sg.maxBars));
        if (out) outcomes.push({ ...sh, ...out });
      }
    }
  }
  return outcomes.sort((a, b) => a.exitAt - b.exitAt);
}
export const summarizeOutcomes = rows => {
  const by = {};
  for (const r of rows) {
    const k = r.strategy + ':' + r.variant, a = by[k] ??= { n: 0, r: 0, w: 0, net: 0, rr: [] };
    a.n++; a.r += r.r; a.w += r.r > 0; a.net += r.net; a.rr.push(r.r);
  }
  return Object.fromEntries(Object.entries(by).map(([k, a]) => {
    const m = a.r / a.n, sd = Math.sqrt(a.rr.reduce((s, x) => s + (x - m) ** 2, 0) / a.n) || 1;
    return [k, { n: a.n, expectancyR: +m.toFixed(3), winRate: +(a.w / a.n).toFixed(3), avgNetPct: +(100 * a.net / a.n).toFixed(3), tStat: +(m / (sd / Math.sqrt(a.n))).toFixed(2) }];
  }));
};
export { roundTrip };

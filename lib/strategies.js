// Five structurally different long-only spot strategies. Each returns null or a signal with ATR-scaled
// stop/target (as fractions of price). Strategies never size or place orders; they only propose.
export const defaultGuards = Object.freeze({ maxExtensionAtr: 1.6, breakoutRelVol: 1.5, costMultiple: 3.5, btcDropPct: 1.5, coolBars: 8 });
export const guardBounds = Object.freeze({
  maxExtensionAtr: [0.6, 2.5, 0.2], breakoutRelVol: [1.2, 2.5, 0.1], costMultiple: [3, 8, 0.5], btcDropPct: [0.5, 3, 0.25], coolBars: [4, 48, 4]
});

const finite = (...v) => v.every(Number.isFinite);
const sig = (ps, p, extra) => {
  const stop = p.stopAtr * ps.atr1h / ps.price, target = p.targetAtr * ps.atr1h / ps.price;
  return { entry: ps.price, stopPct: stop, targetPct: target, rr: target / stop, maxBars: p.maxBars, ...extra };
};

export const strategies = [
  {
    id: 'pullback-trend', family: 'trend',
    variants: [{ id: 'a', stopAtr: 1.5, targetAtr: 3, maxBars: 32 }, { id: 'b', stopAtr: 1.2, targetAtr: 2.4, maxBars: 24 }, { id: 'c', stopAtr: 2, targetAtr: 4.5, maxBars: 64 }],
    evaluate({ s, ps, market, guards }, p) {
      if (ps.label !== 'trend-up' || market.risk === 'off') return null;
      const { i } = ps;
      if (!finite(ps.rsi14, ps.ema20, ps.atr15, ps.atr1h)) return null;
      let dipped = false;
      for (let k = 1; k <= 8; k++) if (s.rsi14[i - k] < 42) dipped = true;
      const ext = (ps.price - ps.ema20) / ps.atr15;
      if (!dipped || !(ps.rsi14 >= 45 && ps.rsi14 <= 62) || ps.price < ps.ema20 || ext > guards.maxExtensionAtr) return null;
      return sig(ps, p, { score: Math.min(1, 0.5 + (ps.h1.adx - 18) / 40), reason: 'Uptrend pullback rebounded above the 15m EMA20 with RSI recovery' });
    }
  },
  {
    id: 'donchian-breakout', family: 'breakout',
    variants: [{ id: 'a', stopAtr: 2, targetAtr: 4, maxBars: 48 }, { id: 'b', stopAtr: 1.6, targetAtr: 4.8, maxBars: 64 }],
    evaluate({ s, ps, market, guards }, p) {
      if (market.risk === 'off' || ps.h1.trend === 'down') return null;
      const { i } = ps, hi = s.donch.hi[i];
      if (!finite(hi, ps.relVol, ps.atr15, ps.atr1h, ps.rsi14)) return null;
      const ext = (ps.price - ps.ema20) / ps.atr15;
      if (!(ps.price > hi && ps.relVol >= guards.breakoutRelVol && ps.h1.adx >= 15 && ps.rsi14 < 80 && ext < guards.maxExtensionAtr + 1.2)) return null;
      return sig(ps, p, { score: Math.min(1, 0.4 + (ps.relVol - 1) / 6), reason: 'Closed above the prior 12h high on expanded volume' });
    }
  },
  {
    id: 'bb-reversion', family: 'reversion',
    variants: [{ id: 'a', stopAtr: 1.6, targetAtr: 2.2, maxBars: 16 }, { id: 'b', stopAtr: 2.2, targetAtr: 3, maxBars: 24 }],
    evaluate({ s, ps, market }, p) {
      if (!['range', 'mixed'].includes(ps.label) || market.risk === 'off') return null;
      const { i } = ps, bar = s.bars[i], lower = s.bb.lower[i];
      if (!finite(lower, ps.rsi2, ps.atr15, ps.atr1h)) return null;
      const touched = Math.min(bar.l, s.bars[i - 1].l) < lower;
      if (!(touched && ps.rsi2 < 15 && bar.c > bar.o && ps.price < s.bb.mid[i])) return null;
      return sig(ps, p, { score: Math.min(1, 0.4 + (15 - ps.rsi2) / 30), reason: 'Lower-band excursion in a range regime with a bullish rebound candle' });
    }
  },
  {
    id: 'squeeze-expansion', family: 'volatility',
    variants: [{ id: 'a', stopAtr: 1.5, targetAtr: 3.2, maxBars: 40 }, { id: 'b', stopAtr: 2, targetAtr: 4, maxBars: 56 }],
    evaluate({ s, ps, market, guards }, p) {
      if (market.risk === 'off' || ps.h1.trend === 'down') return null;
      const { i } = ps;
      let tight = 0;
      for (let k = 1; k <= 12; k++) if (percentRankSafe(s, i - k) <= 0.2) tight++;
      if (!finite(s.bb.upper[i], ps.relVol, ps.atr1h) || tight < 7) return null;
      if (!(ps.price > s.bb.upper[i] && ps.relVol >= guards.breakoutRelVol - 0.2)) return null;
      return sig(ps, p, { score: Math.min(1, 0.45 + tight / 24), reason: 'Volatility squeeze resolved upward on volume' });
    }
  },
  {
    id: 'relative-strength', family: 'momentum',
    variants: [{ id: 'a', stopAtr: 2, targetAtr: 4, maxBars: 64 }, { id: 'b', stopAtr: 2.5, targetAtr: 6, maxBars: 96 }],
    evaluate({ ps, market, cross }, p) {
      if (market.risk === 'off' || !cross?.rank || ps.h1.trend !== 'up') return null;
      if (!(cross.rank <= 3 && cross.z >= 0.8 && ps.rsi14 < 70 && ps.price > ps.ema20)) return null;
      return sig(ps, p, { score: Math.min(1, 0.4 + cross.z / 5), reason: 'Top-ranked 12h/24h relative strength in an uptrend (rank ' + cross.rank + ')', rank: cross.rank });
    }
  }
];

// Bollinger-width percentile computed lazily and memoized per series.
function percentRankSafe(s, i) {
  s._wr ??= new Map();
  if (s._wr.has(i)) return s._wr.get(i);
  let below = 0, n = 0;
  for (let j = Math.max(0, i - 200); j < i; j++) if (Number.isFinite(s.bb.width[j])) { n++; if (s.bb.width[j] < s.bb.width[i]) below++; }
  const v = n >= 120 ? below / n : NaN;
  s._wr.set(i, v);
  return v;
}

// Cross-sectional momentum rank for the whole universe at one timestamp.
export function crossSection(seriesBySymbol, indexBySymbol) {
  const rows = [];
  for (const [sym, s] of Object.entries(seriesBySymbol)) {
    const i = indexBySymbol[sym];
    if (i == null || i < 100) continue;
    const j = s.h1At[i];
    if (j < 24) continue;
    const r12 = s.h1[j].c / s.h1[j - 12].c - 1, r24 = s.h1[j].c / s.h1[j - 24].c - 1;
    const risk = s.h1atr[j] / s.h1[j].c;
    if (!finite(r12, r24, risk) || risk <= 0) continue;
    rows.push({ sym, raw: (0.6 * r12 + 0.4 * r24) / Math.max(risk, 0.002) });
  }
  if (rows.length < 6) return {};
  const m = rows.reduce((a, r) => a + r.raw, 0) / rows.length;
  const sd = Math.sqrt(rows.reduce((a, r) => a + (r.raw - m) ** 2, 0) / rows.length) || 1;
  rows.sort((a, b) => b.raw - a.raw);
  return Object.fromEntries(rows.map((r, k) => [r.sym, { rank: k + 1, z: (r.raw - m) / sd }]));
}

// Evaluate every strategy variant for one symbol. Returns raw signals including cost-gate result.
export function evaluateAll(ctx, costs, guards = defaultGuards) {
  const out = [];
  const { ps } = ctx;
  if (!finite(ps.atr1h, ps.atr15, ps.price)) return out;
  const roundTrip = 2 * (costs.fee + costs.slip) + (costs.spread ?? 0);
  for (const strat of strategies) {
    for (const v of strat.variants) {
      const hit = strat.evaluate({ ...ctx, guards }, v);
      if (!hit) continue;
      const net = hit.targetPct - roundTrip;
      const passes = hit.targetPct >= guards.costMultiple * roundTrip && hit.stopPct >= 0.004 && hit.stopPct <= 0.05;
      out.push({ strategy: strat.id, family: strat.family, variant: v.id, symbol: ctx.symbol, regime: ps.label, market: ctx.market.risk,
        ...hit, roundTrip, netTargetPct: net, costGate: passes });
    }
  }
  return out;
}

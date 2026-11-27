import { adx, aggregate, atr, bollinger, donchian, ema, percentRank, relVolume, rsi, sma } from './indicators.js';

// Precompute causal 15m and 1h indicator arrays once per pair. `h1At[i]` is the newest COMPLETED
// 1h bar at 15m bar i, so no strategy can see a partial hour.
export function buildSeries(bars) {
  const c = bars.map(b => b.c);
  const h1 = aggregate(bars, 60);
  const h1c = h1.map(b => b.c);
  const bb = bollinger(c, 20, 2);
  const h1At = new Array(bars.length).fill(-1);
  for (let i = 0, j = -1; i < bars.length; i++) {
    while (j + 1 < h1.length && h1[j + 1].ct <= bars[i].ct) j++;
    h1At[i] = j;
  }
  return {
    bars, c, h1, h1At,
    ema20: ema(c, 20), ema50: ema(c, 50), rsi14: rsi(c, 14), rsi2: rsi(c, 2), atr15: atr(bars, 14),
    bb, donch: donchian(bars, 48), swingLow: donchian(bars, 12),
    h1ema20: ema(h1c, 20), h1ema50: ema(h1c, 50), h1ema200: ema(h1c, 200), h1adx: adx(h1, 14), h1atr: atr(h1, 14), h1rsi: rsi(h1c, 14),
    volSma: sma(bars.map(b => b.v), 20)
  };
}

const at = (arr, i) => (i >= 0 && i < arr.length ? arr[i] : NaN);

// Per-pair state at 15m index i.
export function pairState(s, i) {
  const b = s.bars[i], j = s.h1At[i], price = b.c;
  const atr15 = s.atr15[i], atr1h = at(s.h1atr, j);
  const ema20 = s.ema20[i];
  const h1e20 = at(s.h1ema20, j), h1e50 = at(s.h1ema50, j), h1a = at(s.h1adx, j), h1aPrev = at(s.h1adx, j - 3);
  const widthRank = percentRank(s.bb.width, i, 200);
  const atrRank = percentRank(s.atr15, i, 200);
  const trend = h1e20 > h1e50 && s.h1[j]?.c > h1e50 ? 'up' : h1e20 < h1e50 && s.h1[j]?.c < h1e50 ? 'down' : 'flat';
  const strength = h1a >= 20 ? 'trending' : h1a < 18 ? 'ranging' : 'transition';
  return {
    i, t: b.ct, price, atr15, atr1h, atr15Pct: atr15 / price, atr1hPct: atr1h / price,
    ema20, ema50: s.ema50[i], rsi14: s.rsi14[i], rsi2: s.rsi2[i], relVol: relVolume(s.bars, i, 20),
    h1: { ema20: h1e20, ema50: h1e50, adx: h1a, adxRising: h1a > h1aPrev, rsi: at(s.h1rsi, j), trend, strength, close: s.h1[j]?.c },
    widthRank, atrRank, squeeze: widthRank <= 0.15,
    label: trend === 'up' && strength !== 'ranging' ? 'trend-up' : trend === 'down' && strength !== 'ranging' ? 'trend-down' :
      strength === 'ranging' ? (widthRank <= 0.2 ? 'squeeze' : 'range') : 'mixed'
  };
}

// Market-wide (BTC-led) risk state used for long-only spot gating.
export function marketState(btc, i, breadth = null, dropPct = 1.5) {
  const j = btc.h1At[i];
  if (j < 24) return { risk: 'neutral', ret1h: 0, ret4h: 0, ret24h: 0, breadth };
  const c = btc.h1.map(b => b.c);
  const ret = k => c[j] / c[j - k] - 1;
  const e50 = at(btc.h1ema50, j), e200 = at(btc.h1ema200, j);
  const up = c[j] > e50 && (Number.isNaN(e200) || e50 > e200 * 0.995);
  const down = c[j] < e50 && ret(4) < -dropPct / 100;
  return { risk: down ? 'off' : up ? 'on' : 'neutral', ret1h: ret(1), ret4h: ret(4), ret24h: ret(24), breadth };
}

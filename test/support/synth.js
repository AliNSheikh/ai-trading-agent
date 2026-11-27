import { rng } from '../../lib/allocator.js';
// Regime-switching, BTC-correlated synthetic 15m candles in Binance kline row format.
export function synth(symbols, n = 1500, seed = 'x', end = Math.floor(Date.now() / 900000) * 900000, start = null) {
  const r = rng(seed), g = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const t0 = end - n * 900000, feed = {};
  const factor = []; let regime = 0, left = 0;
  for (let i = 0; i < n; i++) {
    if (--left <= 0) { regime = [0.0004, -0.0003, 0, 0, 0.0008][Math.floor(r() * 5)]; left = 40 + Math.floor(r() * 200); }
    factor.push(regime + 0.0035 * g());
  }
  for (const [k, s] of symbols.entries()) {
    let p = start ?? 10 + k * 7; const rows = [], beta = s === 'BTCUSDT' ? 1 : 0.6 + r() * 0.8;
    for (let i = 0; i < n; i++) {
      const o = p, ret = beta * factor[i] + 0.0025 * g(); p = o * (1 + ret);
      const hi = Math.max(o, p) * (1 + Math.abs(0.0012 * g())), lo = Math.min(o, p) * (1 - Math.abs(0.0012 * g()));
      const spike = r() < 0.05 ? 2.5 + 2 * r() : 0.6 + r() * 0.8;
      rows.push([t0 + i * 900000, String(o), String(hi), String(lo), String(p), String(1000 * spike), t0 + (i + 1) * 900000 - 1, '0', 0, '0', '0', '0']);
    }
    feed[s] = rows;
  }
  return feed;
}
export const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'TRXUSDT', 'NEARUSDT'];

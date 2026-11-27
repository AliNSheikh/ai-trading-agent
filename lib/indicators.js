// Pure, causal indicator math. Every series value at index i uses bars[0..i] only (no look-ahead).
export const FIFTEEN = 900000;
export function toBars(rows) {
  return rows.map(r => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]), ct: Number(r[6]) }));
}
export function valid(bars) {
  return Array.isArray(bars) && bars.length > 0 && bars.every((b, i) => [b.o, b.h, b.l, b.c, b.v, b.ct].every(Number.isFinite) &&
    b.o > 0 && b.h >= Math.max(b.o, b.c) - 1e-12 && b.l <= Math.min(b.o, b.c) + 1e-12 && b.l > 0 && b.v >= 0 && (!i || b.ct > bars[i - 1].ct));
}
const nan = n => Array(n).fill(NaN);
export function ema(values, n) {
  const out = nan(values.length), k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = values[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}
export function sma(values, n) {
  const out = nan(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}
export function rsi(values, n = 14) {
  const out = nan(values.length);
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1], g = Math.max(0, d), l = Math.max(0, -d);
    if (i <= n) { gain += g / n; loss += l / n; } else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
    if (i >= n) out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
export function atr(bars, n = 14) {
  const out = nan(bars.length);
  let prev = NaN;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    if (i < n) { prev = (Number.isNaN(prev) ? 0 : prev) + tr / n; }
    else { prev = i === n ? prev + tr / n : (prev * (n - 1) + tr) / n; out[i] = prev; }
  }
  return out;
}
export function adx(bars, n = 14) {
  const out = nan(bars.length);
  let tr = 0, pdm = 0, mdm = 0, dxSum = 0, prevAdx = NaN, dxCount = 0;
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h, dn = bars[i - 1].l - bars[i].l;
    const t = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    const p = up > dn && up > 0 ? up : 0, m = dn > up && dn > 0 ? dn : 0;
    if (i <= n) { tr += t; pdm += p; mdm += m; }
    else { tr = tr - tr / n + t; pdm = pdm - pdm / n + p; mdm = mdm - mdm / n + m; }
    if (i < n) continue;
    const pdi = tr ? 100 * pdm / tr : 0, mdi = tr ? 100 * mdm / tr : 0;
    const dx = pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0;
    if (dxCount < n) { dxSum += dx; dxCount++; if (dxCount === n) { prevAdx = dxSum / n; out[i] = prevAdx; } }
    else { prevAdx = (prevAdx * (n - 1) + dx) / n; out[i] = prevAdx; }
  }
  return out;
}
export function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n), upper = nan(values.length), lower = nan(values.length), width = nan(values.length);
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + k * sd; lower[i] = mid[i] - k * sd; width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : NaN;
  }
  return { mid, upper, lower, width };
}
// Highest high / lowest low of the previous n bars (excludes bar i itself).
export function donchian(bars, n) {
  const hi = nan(bars.length), lo = nan(bars.length);
  for (let i = n; i < bars.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - n; j < i; j++) { h = Math.max(h, bars[j].h); l = Math.min(l, bars[j].l); }
    hi[i] = h; lo[i] = l;
  }
  return { hi, lo };
}
// Fraction of the trailing window (excluding i) strictly below series[i].
export function percentRank(series, i, window) {
  let below = 0, count = 0;
  for (let j = Math.max(0, i - window); j < i; j++) if (Number.isFinite(series[j])) { count++; if (series[j] < series[i]) below++; }
  return count >= window * 0.6 ? below / count : NaN;
}
export function relVolume(bars, i, n = 20) {
  let s = 0;
  for (let j = i - n; j < i; j++) s += bars[j]?.v ?? NaN;
  return s > 0 ? bars[i].v / (s / n) : NaN;
}
// Aggregate 15m bars into complete higher-timeframe bars aligned to the epoch grid.
export function aggregate(bars, minutes) {
  const span = minutes * 60000, out = [];
  let cur = null;
  for (const b of bars) {
    const slot = Math.floor(b.t / span) * span;
    if (!cur || cur.t !== slot) { if (cur) out.push(cur); cur = { t: slot, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, ct: b.ct, n: 1 }; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; cur.ct = b.ct; cur.n++; }
  }
  if (cur) out.push(cur);
  return out.filter(b => b.n === minutes / 15 && b.ct + 1 === b.t + span);
}
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return NaN;
  const x = a.slice(-n), y = b.slice(-n), mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

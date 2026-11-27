// Bayesian strategy allocator: decayed sufficient statistics per arm, hierarchical shrinkage so sparse
// pair/regime cells borrow strength from their strategy, and Thompson sampling for exploration.
export const priorMean = -0.10;     // skeptical prior: costs mean an unproven strategy is assumed slightly negative
export const strength = 12;         // pseudo-observations per shrinkage level
export const halfLifeDays = 21;     // evidence decays so the system adapts when regimes change
export const liveMinN = 20, disableMinN = 30;
const clampR = r => Math.max(-2, Math.min(8, r));

export const armKeys = o => ({
  s: 's:' + o.strategy,
  v: 'v:' + o.strategy + ':' + o.variant,
  p: 'p:' + o.strategy + ':' + o.variant + ':' + o.symbol,
  r: 'r:' + o.strategy + ':' + o.variant + ':' + o.regime
});

export function observe(learning, o, now) {
  const r = clampR(o.r);
  for (const key of ['g', ...Object.values(armKeys(o))]) {
    const a = learning.arms[key] ??= { n: 0, s: 0, ss: 0, w: 0, t: now };
    const f = Math.pow(0.5, Math.max(0, now - a.t) / (halfLifeDays * 86400000));
    a.n = a.n * f + 1; a.s = a.s * f + r; a.ss = a.ss * f + r * r; a.w = a.w * f + (r > 0 ? 1 : 0); a.t = now;
  }
}
const view = (learning, key, now) => {
  const a = learning.arms[key];
  if (!a) return { n: 0, mean: 0, var: NaN };
  const f = Math.pow(0.5, Math.max(0, now - a.t) / (halfLifeDays * 86400000)), n = a.n * f;
  if (n < 1e-6) return { n: 0, mean: 0, var: NaN };
  const mean = a.s / a.n;
  return { n, mean, var: Math.max(0, a.ss / a.n - mean * mean) };
};
const shrink = (est, v) => (strength * est + v.n * v.mean) / (strength + v.n);

export function estimate(learning, o, now) {
  const k = armKeys(o);
  const [vs, vv, vr, vp] = [view(learning, k.s, now), view(learning, k.v, now), view(learning, k.r, now), view(learning, k.p, now)];
  let est = shrink(priorMean, vs);
  est = shrink(est, vv); est = shrink(est, vr); est = shrink(est, vp);
  const sigma = Math.max(0.6, Math.min(2.2, Number.isFinite(vv.var) && vv.n >= 8 ? Math.sqrt(vv.var) : 1.1));
  const nEff = vv.n + 0.5 * (vr.n + vp.n);
  const se = sigma / Math.sqrt(strength + nEff);
  const z = est / se;
  return { est, sigma, se, nVariant: vv.n, nPair: vp.n, nRegime: vr.n, lcb: est - se, pPos: normalCdf(z), winRate: vv.n ? (learning.arms[k.v].w / learning.arms[k.v].n) : null };
}
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
export function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

// mode: live (validated edge, full sizing), probe (exploration at minimum size), shadow (paper only), disabled.
export function decide(e, random) {
  if (e.nVariant >= disableMinN && e.pPos < 0.10) return { mode: 'disabled', riskMult: 0, score: e.est, reason: 'Posterior expectancy is negative with sufficient evidence' };
  if (e.nVariant >= liveMinN && e.lcb > 0) {
    return { mode: 'live', riskMult: Math.max(0.5, Math.min(1.5, 0.5 + 3 * e.est / e.sigma)), score: e.est, reason: 'Edge validated: lower bound ' + e.lcb.toFixed(2) + 'R over ' + e.nVariant.toFixed(0) + ' trades' };
  }
  const theta = e.est + e.se * gauss(random);
  if (theta > 0) return { mode: 'probe', riskMult: 0.25, score: theta, reason: 'Thompson exploration draw ' + theta.toFixed(2) + 'R' };
  return { mode: 'shadow', riskMult: 0, score: theta, reason: 'Unproven; paper tracking only' };
}
export function leaderboard(learning, now) {
  const rows = [];
  for (const key of Object.keys(learning.arms)) {
    if (!key.startsWith('v:')) continue;
    const [, strategy, variant] = key.split(':');
    const e = estimate(learning, { strategy, variant, symbol: '-', regime: '-' }, now);
    rows.push({ strategy, variant, n: Math.round(e.nVariant), expectancyR: +e.est.toFixed(3), lcbR: +e.lcb.toFixed(3), pPositive: +e.pPos.toFixed(2), winRate: e.winRate == null ? null : +e.winRate.toFixed(2) });
  }
  return rows.sort((a, b) => b.lcbR - a.lcbR);
}

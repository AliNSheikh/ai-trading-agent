import { defaultGuards, guardBounds } from './strategies.js';

// Deterministic loss classification. No LLM is involved, so learning keeps working when AI quota is exhausted.
export function classify(t) {
  const tags = [];
  if (t.r >= 0) return tags;
  const f = t.features ?? {};
  if (t.exit === 'stop' && t.bars <= 3) tags.push('fast-stop');
  if (Number.isFinite(t.btcMove) && t.btcMove <= -0.005) tags.push('market-beta');
  if (Number.isFinite(f.extAtr) && f.extAtr >= 1.0) tags.push('late-entry');
  if (t.family === 'breakout' && Number.isFinite(f.relVol) && f.relVol < 1.9) tags.push('weak-volume');
  if (t.exit === 'time' && t.mfe < 0.5) tags.push('time-drift');
  if (t.roundTrip && t.stopPct && t.roundTrip / t.stopPct > 0.25 && t.r > -0.6) tags.push('fee-drag');
  if (!tags.length) tags.push('normal-loss');
  return tags;
}

const window = 40;
export function recordOutcome(learning, o, now) {
  learning.recent.push({ t: now, k: o.strategy + ':' + o.variant, f: o.family, r: +o.r.toFixed(3), tags: o.tags, x: o.exit });
  if (learning.recent.length > 160) learning.recent.splice(0, learning.recent.length - 160);
}
const share = (losses, tag) => losses.length ? losses.filter(x => x.tags.includes(tag)).length / losses.length : 0;
const meanR = rows => rows.length ? rows.reduce((s, x) => s + x.r, 0) / rows.length : 0;

function setGuard(learning, name, value, evidence, now) {
  const [lo, hi, step] = guardBounds[name];
  const next = Math.max(lo, Math.min(hi, Math.round(value / step) * step));
  const prev = learning.guards[name];
  if (Math.abs(next - prev) < 1e-9) return false;
  learning.guards[name] = +next.toFixed(4);
  learning.changes.push({ at: now, guard: name, from: prev, to: +next.toFixed(4), evidence, baselineR: +meanR(learning.recent.slice(-window)).toFixed(3),
    sinceN: learning.recent.length, status: 'trial' });
  if (learning.changes.length > 40) learning.changes.shift();
  return true;
}

// Adapt guards from the recent loss mix. Hard bounds, one-step moves, at most one change per review, and
// automatic reversion when the following outcomes are worse than the baseline.
export function adapt(learning, now) {
  const log = [];
  // 1. Judge trial changes that have matured.
  for (const c of learning.changes) {
    if (c.status !== 'trial' || learning.recent.length - c.sinceN < 30) continue;
    const after = meanR(learning.recent.slice(c.sinceN));
    if (after < c.baselineR - 0.05) {
      learning.guards[c.guard] = c.from; c.status = 'reverted';
      log.push('Reverted ' + c.guard + ' to ' + c.from + ': expectancy ' + after.toFixed(2) + 'R vs baseline ' + c.baselineR + 'R');
    } else { c.status = 'kept'; log.push('Kept ' + c.guard + '=' + c.to + ' (' + after.toFixed(2) + 'R after change)'); }
  }
  if (learning.changes.some(c => c.status === 'trial')) return log;   // one experiment at a time
  const losses = learning.recent.filter(x => x.r < 0).slice(-30);
  if (losses.length < 20) return log;
  const g = learning.guards;
  const rules = [
    ['market-beta', 0.35, 'btcDropPct', g.btcDropPct - 0.25],
    ['late-entry', 0.30, 'maxExtensionAtr', g.maxExtensionAtr - 0.2],
    ['weak-volume', 0.30, 'breakoutRelVol', g.breakoutRelVol + 0.1],
    ['fee-drag', 0.25, 'costMultiple', g.costMultiple + 0.5],
    ['fast-stop', 0.40, 'coolBars', g.coolBars + 4]
  ];
  for (const [tag, threshold, guard, value] of rules) {
    const s = share(losses, tag);
    if (s >= threshold && setGuard(learning, guard, value, tag + ' in ' + Math.round(s * 100) + '% of last ' + losses.length + ' losses', now)) {
      log.push('Tightened ' + guard + ' because ' + tag + ' explained ' + Math.round(s * 100) + '% of recent losses'); return log;
    }
  }
  // 2. Relax toward defaults when no failure mode dominates, so guards cannot ratchet the system into inactivity.
  if (losses.every(() => true) && ['market-beta', 'late-entry', 'weak-volume', 'fee-drag', 'fast-stop'].every(t => share(losses, t) < 0.12)) {
    for (const name of Object.keys(defaultGuards)) {
      const d = defaultGuards[name], cur = g[name], dir = Math.sign(d - cur);
      if (dir && setGuard(learning, name, cur + dir * guardBounds[name][2], 'no dominant failure mode; relaxing toward default', now)) {
        log.push('Relaxed ' + name); break;
      }
    }
  }
  return log;
}

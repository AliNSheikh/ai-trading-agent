import { autonomyConfigured } from './playbook.js';
import { inUsd, periods } from './settings.js';

export const trialPolicy = 'manager-demo-trial-v1';
export const trialPairs = Object.freeze(['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'VTHOUSDT']);
export const trialRiskPercent = 1.5;
export const maxTrialUsd = 1.5;
const dayMs = 86400000;
const cooldown = 12 * 3600000;

export const trialsEnabled = () => autonomyConfigured() && process.env.DEMO_MANAGER_TRIALS_ENABLED === 'true';

export function trialBlock(state, symbol, decision, now = Date.now()) {
  if (!trialsEnabled() || decision.manager?.policy !== trialPolicy || decision.manager?.side !== 'BUY') return 'Manager trial authority unavailable';
  if (!trialPairs.includes(symbol) || !state.settings.pairs.includes(symbol)) return 'Trial requires an enabled low-minimum pair';
  if (Object.values(state.positions).some(position => position.mode === 'demo-trial')) return 'An existing trial must exit first';
  if (decision.rule === 'execution-check' && state.trial?.verifiedFill) return 'First-fill trial already completed';
  if (inUsd(state.settings, 'riskPerTrade') < 1.01) return 'Saved risk cannot fund a 1 USDT Demo minimum';
  const { day } = periods(now);
  if (state.trial?.day === day && state.trial.opens >= 1) return 'One trial entry is allowed per Gulf Standard Time day';
  const priorLoss = (state.feedback?.losses ?? []).findLast(item => item.symbol === symbol && item.entryRule === decision.rule &&
    now - Date.parse(item.exitAt) < cooldown);
  const rejection = (state.feedback?.rejections ?? []).findLast(item => item.symbol === symbol && item.side === 'BUY' &&
    now - Date.parse(item.at) < cooldown);
  if (priorLoss || rejection) return 'Learning cooldown after a losing or rejected order';
  return null;
}

export function planTrades(state, candidates, markets, advisory, { preview = false, verificationReady = advisory, now = Date.now() } = {}) {
  const plan = [];
  const phase = trialPairs.filter(symbol => state.settings.pairs.includes(symbol));
  const mark = (candidate, mode) => ({ ...candidate, mode,
    manager: { policy: trialPolicy, side: candidate.side, reason: candidate.reason } });
  const { day } = periods(now);
  const wasTried = state.trial?.day === day && state.trial.opens >= 1;
  const openTrial = Object.values(state.positions).some(position => position.mode === 'demo-trial');

  for (const candidate of candidates) {
    const position = state.positions[candidate.symbol];
    const market = markets[candidate.symbol];
    if (position?.mode === 'demo-trial') {
      const age = now - Date.parse(position.time);
      const move = market.price / position.price - 1;
      const reason = move <= -0.012 ? 'Trial loss threshold reached' : move >= 0.015 ? 'Trial profit threshold reached' :
        age >= 3600000 ? 'One-hour trial horizon elapsed' : candidate.side === 'SELL' ? candidate.reason : null;
      plan.push(mark({ ...candidate, side: reason ? 'SELL' : 'HOLD', reason: reason ?? 'Trial remains within its exit limits' }, 'demo-trial'));
    } else if (candidate.side === 'SELL') {
      plan.push(mark(candidate, 'qualified'));
    } else if (candidate.side === 'BUY' && candidate.forecast?.eligible && advisory) {
      plan.push(mark(candidate, 'qualified'));
    } else if (candidate.side === 'BUY' && advisory && (preview || trialsEnabled()) &&
        phase.includes(candidate.symbol) && !wasTried && !openTrial) {
      const trial = mark(candidate, 'demo-trial');
      if (preview || !trialBlock(state, candidate.symbol, trial, now)) plan.push(trial);
      else plan.push({ ...candidate, manager: { side: 'HOLD', reason: trialBlock(state, candidate.symbol, trial, now) } });
    } else {
      plan.push({ ...candidate, manager: { side: 'HOLD', reason: candidate.side === 'BUY' ?
        advisory ? candidate.forecast?.reason ?? 'Held-out evidence required' : 'Market, news, or strategy review unavailable' : candidate.reason } });
    }
  }
  // A one-time lifecycle check exercises the exchange even if no investable setup qualifies.
  if ((preview || trialsEnabled()) && verificationReady && !state.trial?.verifiedFill && !wasTried && !openTrial &&
      !plan.some(item => item.manager.side === 'SELL' || item.manager.side === 'BUY')) {
    for (const symbol of phase) {
      const index = plan.findIndex(item => item.symbol === symbol && markets[symbol]?.volume > 0 && !state.positions[symbol]);
      if (index < 0) continue;
      const trial = mark({ ...plan[index], side: 'BUY', rule: 'execution-check',
        reason: 'First-fill lifecycle check on Binance Demo Spot' }, 'demo-trial');
      if (!preview && trialBlock(state, symbol, trial, now)) continue;
      plan[index] = trial;
      break;
    }
  }
  const score = item => item.manager.side === 'SELL' ? 3 : item.manager.side === 'BUY' ?
    item.mode === 'qualified' ? 2 : 1 : 0;
  const average = item => {
    const recent = (state.feedback?.completed ?? []).filter(fill => fill.symbol === item.symbol &&
      fill.entryRule === item.rule && now - Date.parse(fill.exitAt) < 14 * dayMs);
    return recent.length ? recent.reduce((sum, fill) => sum + fill.net, 0) / recent.length : 0;
  };
  return plan.sort((a, b) => score(b) - score(a) || (b.forecast?.probability ?? 0) - (a.forecast?.probability ?? 0) ||
    average(b) - average(a) || (markets[b.symbol]?.relativeVolume ?? 0) - (markets[a.symbol]?.relativeVolume ?? 0));
}

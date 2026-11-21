import { inUsd, periods } from './settings.js';
import { orderModel } from './playbook.js';

export function entryDiagnostics(state, { autonomous = false, minNotional = 5 } = {}) {
  const blockers = [];
  const { day, month } = periods();
  const model = orderModel(state);
  const protectedTraining=autonomous && process.env.DEMO_BRACKET_ENABLED==='true';
  if (state.stopped) blockers.push({ code: 'stopped', message: 'Administrator emergency stop is active.' });
  if (state.pending) blockers.push({ code: 'pending', message: 'Previous Demo order requires reconciliation.' });
  if (!state.verification || state.verification.expires <= Date.now()) {
    blockers.push({ code: 'verification', message: 'Demo order verification is missing or expired.' });
  }
  if (!protectedTraining && (!model || !Object.keys(model.models ?? {}).length)) {
    blockers.push({ code: 'model', message: 'No qualified forecast model exists; held-out validation must pass before automated entries.' });
  }
  const limits = ['dailyVolume', 'maxPosition', 'riskPerTrade', 'dailyLoss', 'monthlyLoss'];
  const budget = Object.fromEntries(limits.map(k => [k, inUsd(state.settings, k)]));
  const maximumNotional = Math.min(...Object.values(budget));
  if (!protectedTraining && Number.isFinite(minNotional) && maximumNotional < minNotional) {
    blockers.push({ code: 'notional', message: 'The current full-loss risk budget is below the smallest Demo Spot order. Do not bypass this without redesigning protective exits and risk accounting.' });
  }
  const report = state.managerReports?.[day] ?? Object.values(state.managerReports ?? {}).sort((a,b)=>b.day.localeCompare(a.day))[0];
  const neural = state.latest?.['Learning Agent']?.output?.neural ?? {};
  const modelAssessment = Object.fromEntries(Object.entries(neural).map(([symbol, result]) => [symbol, { status: result.status, eligibleRules: Object.entries(result.rules ?? {}).filter(([, r]) => r.eligible).map(([rule]) => rule) }]));
  return {
    mode: 'Binance Demo Spot only',
    automaticallyConfigured: autonomous,
    protectedTraining: {enabled: protectedTraining, dailyCap:1,
      usedToday:state.days?.[day]?.experimental??0,
      modelStatus: model?'approved research model':'exploratory Demo-only; no statistically validated model',
      method:'Exchange-native linked OPOCO with estimated stop and fee risk; execution price not guaranteed'},
    safeToOpenNewPositions: blockers.length === 0,
    blockers,
    tradingBudgetUsd: budget,
    maximumEntryNotionalUsd: maximumNotional,
    minimumDemoNotionalUsd: minNotional,
    date: day,
    month,
    lastDecisionReasons: report?.reasons ?? {},
    modelAssessment,
    statusExplanation: protectedTraining ? 'Protected Demo training may open a small experimental trade if the General Manager and risk gates pass; qualified strategy evidence is still absent.' :
      blockers.some(b=>b.code==='model') ? 'No trade is an expected safety outcome when training and forward testing fail.' : null
  };
}

import { periods } from './settings.js';
import { forecastVersion, trainForecast } from './forecast.js';
import { historicalCandles } from './demo.js';
import { playbookId } from './playbook.js';
import { protectedDemoEnabled } from './protected-demo.js';
import { walkForward } from './strategy-lab.js';

export const team = Object.freeze([
  { name: 'Maya Chen', agent: 'Market Analyst', title: 'Market Analyst', desk: 'market' },
  { name: 'Samir Haddad', agent: 'News Analyst', title: 'News & Sentiment Analyst', desk: 'news' },
  { name: 'Nora Patel', agent: 'Strategy Agent', title: 'Strategy Researcher', desk: 'strategy' },
  { name: 'Omar Rahman', agent: 'Risk Manager', title: 'Risk Manager', desk: 'risk' },
  { name: 'Lina Torres', agent: 'Learning Agent', title: 'Learning Engineer', desk: 'learning' },
  { name: 'Alex Morgan', agent: 'General Manager', title: 'General Manager', desk: 'manager' }
]);

export async function modelReview(state, id, rows, now = Date.now()) {
  const results = await Promise.all(state.settings.pairs.map(async symbol => {
    try {
      if (!rows[symbol]?.length) throw Error('Market candles unavailable');
      const sample = await historicalCandles(symbol, rows[symbol]);
      return [symbol, trainForecast(sample, state.strategy, (state.lessons ?? []).filter(item => item.symbol === symbol)), walkForward(sample.slice(-1100), state.strategy)];
    } catch {
      return [symbol, { status: 'unavailable', reason: 'Historical Demo candles could not be validated' }, { status: 'unavailable' }];
    }
  }));
  const models = Object.fromEntries(results.filter(([, result]) => result.status === 'eligible')
    .map(([symbol, result]) => [symbol, { artifact: result.artifact, metrics: result.metrics, rules: result.rules }]));
  const report = Object.fromEntries(results.map(([symbol, { status, metrics, reason, samples, rules }]) =>
    [symbol, { status, metrics, reason, samples, rules }]));
  const strategyLab=Object.fromEntries(results.map(([symbol,,lab])=>[symbol,lab]));
  return {
    report, strategyLab,
    proposal: Object.keys(models).length ? {
      id, version: forecastVersion, playbook: playbookId, strategy: state.strategy.id, createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 14 * 86400000).toISOString(), models
    } : null
  };
}

export function collectLessons(prior, record) {
  const errors = [...(prior?.errors ?? [])].map(item => ({ ...item }));
  for (const { agent, error, status } of record.agents) {
    if (status !== 'unavailable' || !error) continue;
    const old = errors.find(item => item.agent === agent && item.error === error);
    if (old) {
      old.count++;
      old.lastAt = record.startedAt;
    } else {
      errors.push({ agent, error, count: 1, lastAt: record.startedAt });
    }
  }
  const losses = [
    ...(prior?.losses ?? []),
    ...record.trades.filter(fill => fill.netProfit < 0).map(fill => ({
      symbol: fill.symbol, strategy: fill.strategy, exitAt: fill.time, net: fill.netProfit,
      lesson: fill.feeUsd > Math.abs(fill.netProfit) * 0.5 ? 'Review fee drag against expected edge' :
        'Compare this losing exit with its entry indicators and review the exit trigger'
    }))
  ].slice(-25);
  return { errors: errors.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 24), losses };
}

export function managerExecutionStatus(state, { trainingEnabled = false } = {}) {
  const eligible = Boolean(state.activeModel?.models && Object.keys(state.activeModel.models).length ||
    state.autonomousModel?.models && Object.keys(state.autonomousModel.models).length);
  const { day } = periods();
  const used = state.days?.[day]?.experimental ?? 0;
  const lastManager = state.managerReports?.[day]?.demoOrderDirective ?? null;
  const blockers = [];
  if (state.stopped) blockers.push('Emergency stop is active');
  if (state.pending) blockers.push('Exchange order requires reconciliation');
  if (trainingEnabled && used >= 1) blockers.push('Daily exploratory Demo entry cap reached');
  return {
    forecast: {
      status: eligible ? 'qualified' : 'researching',
      description: eligible ? 'At least one approved forecast model is available.' :
        'Forecast models are still being validated against independent evidence; none is approved yet.'
    },
    training: {
      status: !trainingEnabled ? 'disabled' : blockers.length ? 'paused' : 'monitoring',
      enabled: trainingEnabled,
      usedToday: used,
      dailyCap: 1,
      description: !trainingEnabled ? 'Protected exploratory Demo execution is not enabled.' :
        blockers.length ? 'Protected Demo training cannot open a new entry: ' + blockers.join('; ') + '.' :
          'Protected exploratory Demo training is enabled; orders still require a qualifying manager signal and risk checks.',
      blockers
    },
    lastManagerDecision: lastManager ? {
      side: lastManager.side, symbol: lastManager.symbol ?? null,
      rule: lastManager.rule ?? null, reason: lastManager.reason ?? null
    } : null
  };
}

export function managerReport(state, record, feedback) {
  const { day } = periods(Date.parse(record.startedAt));
  const previous = state.managerReports?.[day];
  const decisions = previous ? { ...previous.decisions } : { BUY: 0, SELL: 0, HOLD: 0 };
  const reasons = previous ? { ...previous.reasons } : {};
  const knownReasons = new Set(Object.keys(reasons));
  for (const decision of record.decisions) {
    decisions[decision.side]++;
    const reason = decision.risk?.code ?? 'unavailable';
    if (knownReasons.has(reason) || knownReasons.size < 20) {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      knownReasons.add(reason);
    }
  }
  const reports = {
    day, updatedAt: new Date().toISOString(), cycles: (previous?.cycles ?? 0) + 1, decisions, reasons,
    degraded: (previous?.degraded ?? 0) + Number(Boolean(record.error)),
    fills: (previous?.fills ?? 0) + record.trades.filter(trade => trade.quantity > 0).length,
    realized: (previous?.realized ?? 0) + record.trades.reduce((total, trade) => total + (trade.netProfit ?? 0), 0),
    observedForecasts: (previous?.observedForecasts ?? 0) + (record.forecastResults?.length ?? 0),
    strategyTests: (previous?.strategyTests ?? 0) + record.decisions.reduce((sum, item) => sum + (item.testedRules?.length ?? 0), 0),
    agents: Object.fromEntries(record.agents.map(row => [row.agent, { status: row.status, issue: row.error }])),
    priorities: [],
    executionStatus: managerExecutionStatus(state, { trainingEnabled: protectedDemoEnabled() }),
    qa: record.qa ?? previous?.qa ?? null
  };
  if (record.error) reports.priorities.push('Review the failed or rate-limited service before relying on entry signals.');
  if (state.pending) reports.priorities.push('Reconcile the pending Demo order before allowing a new order.');
  if (state.stopped) reports.priorities.push('Demo execution is stopped.');
  if (reports.executionStatus.forecast.status !== 'qualified') {
    reports.priorities.push('Forecast research: no model has passed independent evidence checks yet.');
  }
  if (reports.executionStatus.training.enabled) {
    reports.priorities.push(reports.executionStatus.training.description);
  } else {
    reports.priorities.push('Protected Demo training: disabled; a qualified model is required for non-training entries.');
  }
  if (record.managerOrder?.side === 'HOLD' && record.managerOrder.reason) {
    reports.priorities.push('General Manager: ' + record.managerOrder.reason);
  } else if (record.managerOrder?.side === 'BUY') {
    reports.priorities.push('General Manager selected ' + record.managerOrder.symbol + ' / ' +
      record.managerOrder.rule + ' for protected Demo risk evaluation.');
  }
  if (feedback.losses.length) reports.priorities.push('Review the latest losing fills and the associated fee and exit analysis.');
  if (!reports.priorities.length) reports.priorities.push('Continue monitoring results and review new model proposals.');
  return reports;
}

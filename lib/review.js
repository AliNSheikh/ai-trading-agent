import { periods } from './settings.js';
import { forecastVersion, trainForecast } from './forecast.js';
import { historicalCandles } from './demo.js';
import { playbookId } from './playbook.js';
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
      return [symbol, trainForecast(sample, state.strategy, (state.lessons ?? []).filter(item => item.symbol === symbol)), walkForward(sample, state.strategy)];
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
    qa: record.qa ?? previous?.qa ?? null
  };
  if (record.error) reports.priorities.push('Review the failed or rate-limited service before relying on entry signals.');
  if (state.pending) reports.priorities.push('Reconcile the pending Demo order before allowing a new order.');
  if (state.stopped) reports.priorities.push('Demo execution is stopped.');
  if (!state.activeModel && !state.autonomousModel) reports.priorities.push('Waiting for a forecast model to pass the evidence checks.');
  if (feedback.losses.length) reports.priorities.push('Review the latest losing fills and the associated fee and exit analysis.');
  if (!reports.priorities.length) reports.priorities.push('Continue monitoring results and review new model proposals.');
  return reports;
}

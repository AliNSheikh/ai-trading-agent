import { periods } from './settings.js';
import { forecastVersion, trainForecast } from './forecast.js';
import { historicalCandles } from './demo.js';
import { playbookId } from './playbook.js';

export const team = Object.freeze([
  { name: 'Maya Chen', agent: 'Market Analyst', title: 'Market Analyst', desk: 'market', task: 'Validate closed Demo candles and flag stale or missing pairs.' },
  { name: 'Samir Haddad', agent: 'News Analyst', title: 'News & Sentiment Analyst', desk: 'news', task: 'Verify headline sources and report sentiment without recommending orders.' },
  { name: 'Nora Patel', agent: 'Strategy Agent', title: 'Strategy Researcher', desk: 'strategy', task: 'Evaluate entry and exit rules and explain the evidence to the manager.' },
  { name: 'Omar Rahman', agent: 'Risk Manager', title: 'Risk Manager', desk: 'risk', task: 'Enforce exposure limits, verify exchange filters, and reconcile fills.' },
  { name: 'Lina Torres', agent: 'Learning Agent', title: 'Learning Engineer', desk: 'learning', task: 'Measure outcomes after fees, review mistakes, and test changes on unseen data.' },
  { name: 'Alex Morgan', agent: 'General Manager', title: 'General Manager', desk: 'manager', task: 'Choose entries, exits, or holds and delegate approved intents to Risk.' }
]);

export async function modelReview(state, id, rows, now = Date.now()) {
  const results = await Promise.all(state.settings.pairs.map(async symbol => {
    try {
      if (!rows[symbol]?.length) throw Error('Market candles unavailable');
      const sample = await historicalCandles(symbol, rows[symbol]);
      const actualMistakes = (state.feedback?.completed ?? []).filter(item => item.symbol === symbol && item.net < 0 &&
        item.entryRule !== 'execution-check' && Number.isFinite(Date.parse(item.entryCandle)));
      const mistakes = [...(state.lessons ?? []).filter(item => item.symbol === symbol),
        ...actualMistakes.map(item => ({ at: Date.parse(item.entryCandle), net: item.net }))];
      return [symbol, trainForecast(sample, state.strategy, mistakes)];
    } catch {
      return [symbol, { status: 'unavailable', reason: 'Historical Demo candles could not be validated' }];
    }
  }));
  const models = Object.fromEntries(results.filter(([, result]) => result.status === 'eligible')
    .map(([symbol, result]) => [symbol, { artifact: result.artifact, metrics: result.metrics, rules: result.rules }]));
  const report = Object.fromEntries(results.map(([symbol, { status, metrics, reason, samples, rules }]) =>
    [symbol, { status, metrics, reason, samples, rules }]));
  return {
    report,
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
      symbol: fill.symbol, strategy: fill.strategy, exitAt: fill.time, net: fill.netProfit, entryRule: fill.entryRule,
      entryMode: fill.entryMode, entryPrice: fill.entryPrice, exitPrice: fill.price, fees: fill.feeUsd,
      lesson: fill.feeUsd > Math.abs(fill.netProfit) * 0.5 ? 'Review fee drag against expected edge' :
        'Compare this losing exit with its entry indicators and review the exit trigger'
    }))
  ].slice(-25);
  const completed = [...(prior?.completed ?? []), ...record.trades.filter(fill => Number.isFinite(fill.netProfit)).map(fill => ({
    symbol: fill.symbol, entryRule: fill.entryRule, mode: fill.entryMode, exitAt: fill.time,
    net: fill.netProfit, entryCandle: fill.entryCandle, fees: fill.feeUsd
  }))].slice(-100);
  const rejections = [...(prior?.rejections ?? []), ...(record.trades ?? []).filter(fill => fill.status === 'REJECTED').map(fill => ({
    symbol: fill.symbol, side: fill.side, at: fill.time
  })), ...(record.decisions ?? []).filter(row => row.risk?.code === 'trial-preflight').map(row => ({
    symbol: row.symbol, side: row.side, at: row.timestamp
  }))].slice(-40);
  return { errors: errors.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 24), losses, completed, rejections };
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
  if (!state.activeModel && !state.autonomousModel) reports.priorities.push('Qualified entries wait for stronger evidence. The manager can run bounded Demo trials when enabled.');
  if (feedback.losses.length) reports.priorities.push('Review the latest losing fills and the associated fee and exit analysis.');
  if (!reports.priorities.length) reports.priorities.push('Continue monitoring results and review new model proposals.');
  return reports;
}

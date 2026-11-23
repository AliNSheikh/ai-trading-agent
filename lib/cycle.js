import { createHash, randomUUID } from 'node:crypto';
import { learningAgent, marketAnalyst, names, newsAnalyst, signal, strategyAgent } from './agents.js';
import { candles } from './demo.js';
import { forecastAssessment, settleForecasts } from './forecast.js';
import { applyFill, evaluateOrder, executionAllowed, previewTrialOrder, resolvePending, verifyExecution } from './orders.js';
import { planTrades, trialPolicy, trialRiskPercent, trialsEnabled } from './manager.js';
import { openAIQuality } from './openai-check.js';
import { autonomyConfigured, entryCandidates, orderModel, playbookId } from './playbook.js';
import { qaDue, runDemoQA } from './qa.js';
import { managerDirective } from './strategy-lab.js';
import { protectivePlan } from './protective-plan.js';
import { collectLessons, managerReport, modelReview } from './review.js';
import { authorizedSettings, inUsd, periods, settingsRevision } from './settings.js';
import { appendRun, changeState, getState } from './store.js';

const leaseLength = 240000;
const timestamp = () => new Date().toISOString();
const errorText = error => error instanceof Error && /^[a-z0-9][a-z0-9 .:;()_-]{0,180}$/i.test(error.message)
  ? error.message : 'Service unavailable';

async function runAgent(record, name, inputs, perform) {
  const row = { agent: name, startedAt: timestamp(), inputs, output: null, error: null, usage: null };
  record.agents.push(row);
  try {
    const result = await perform(value => { row.inputs = value; });
    row.output = result.output ?? null;
    row.error = result.error ?? null;
    row.usage = result.usage ?? null;
  } catch (error) {
    row.error = errorText(error);
  } finally {
    row.finishedAt = timestamp();
    row.status = row.error ? 'unavailable' : 'complete';
  }
  return row;
}

function explain({ side, reason, forecast }) {
  if (side === 'HOLD') return reason;
  if (side === 'BUY' && forecast) return forecast.reason + '. ' + reason;
  return reason;
}

async function strategyReview(input, state, id, source) {
  if (!input.candidates.length) throw Error('Current Demo market data required');
  if (input.candidates.every(([, side]) => side === 'HOLD') && source !== 'admin') {
    return { output: { explanation: 'No pair met an entry or exit rule', weakness: 'Continue monitoring pair-specific reasons' } };
  }
  if (!input.sentiment) throw Error('Verified news sentiment unavailable');
  const key = createHash('sha256').update(JSON.stringify([
    input.rules.id, input.playbook, input.sentiment, input.candidates
  ])).digest('hex');
  const memory = state.latest[names[2]];
  const prior = memory?.output;
  const original = prior?.reusedFrom ?? memory?.at;
  if (prior?.cacheKey === key && Date.now() - Date.parse(original) < 2 * 3600000) {
    return { output: { ...prior, reusedFrom: original } };
  }
  const result = await strategyAgent(input, id);
  if (result.output) result.output.cacheKey = key;
  return result;
}

export async function runCycle(source, requestId = randomUUID()) {
  const now = Date.now();
  const { day } = periods(now);
  const hour = Math.floor(now / 3600000);
  const automatic = source === 'schedule' || source === 'preview-verification';
  const scheduledKey = source === 'preview-verification' ? 'previewHour' : 'researchHour';
  const deployment = process.env.VERCEL_GIT_COMMIT_SHA;
  const slot = hour + ':' + (deployment ?? 'development');
  const id = randomUUID();
  const acquired = await changeState(state => {
    if (state.lease?.until > now) return { unchanged: true, value: { status: 'busy' } };
    if ((automatic && state.lastScheduled[scheduledKey] === slot) || state.operations[requestId]) {
      return { unchanged: true, value: { status: 'duplicate' } };
    }
    if (source === 'admin' && state.lastManualCycle > now - 60000) return { unchanged: true, value: { status: 'limited' } };
    let changed = false;
    if (automatic && deployment && !state.pending && state.settingsRevision !== settingsRevision) {
      const settings = authorizedSettings(state.settings);
      state.settingsRelease = { revision: settingsRevision, at: timestamp(), previous: state.settings, next: settings };
      state.settings = settings;
      state.settingsRevision = settingsRevision;
      changed = true;
    }
    const previewTrials = source === 'preview-verification' && process.env.DEMO_MANAGER_TRIALS_ENABLED === 'true';
    if (automatic && deployment && !state.pending && (previewTrials || trialsEnabled()) && state.managerRiskRevision !== trialPolicy) {
      const previous = state.settings;
      state.settings = { ...previous, riskPerTrade: { mode: 'percent', value: trialRiskPercent } };
      state.managerRiskRevision = trialPolicy;
      state.settingsRelease = { revision: trialPolicy, at: timestamp(), previous, next: state.settings };
      changed = true;
    }
    state.lease = { id, until: now + leaseLength };
    for (const [key, entry] of Object.entries(state.operations)) if (entry.time < now - 86400000) delete state.operations[key];
    state.operations[requestId] = { time: now, action: 'research', cycle: id };
    if (automatic) state.lastScheduled[scheduledKey] = slot;
    if (source === 'admin') state.lastManualCycle = now;
    return { status: 'started', state, changed };
  });
  if (acquired.status !== 'started') return { status: acquired.status };
  const state = acquired.state;
  const record = {
    id, previous: state.head, startedAt: timestamp(), source, mode: 'binance-demo-spot',
    strategy: state.strategy, agents: [], decisions: [], trades: [], forecastResults: [], qa: null, error: null,
    playbook: playbookId, appliedSettings: acquired.changed ? state.settingsRelease : null
  };
  let reconciliation = null;
  let review = null;
  let modelProposal = null;
  let manager;
  let managerDecision = null;
  const previewTrials = source === 'preview-verification' && process.env.DEMO_MANAGER_TRIALS_ENABLED === 'true';
  let queued = state.forecastQueue ?? [];
  const priorBenchmark = state.connectivityBenchmark;
  const benchmarkDue = automatic && deployment && (priorBenchmark?.sha !== deployment ||
    priorBenchmark.status !== 'passed' && now - Date.parse(priorBenchmark.startedAt) >= 4 * 3600000);
  const benchmark = benchmarkDue ? await openAIQuality(id, deployment) : state.connectivityBenchmark;
  if (benchmarkDue) record.openAIBenchmark = benchmark;
  if (automatic && autonomyConfigured() && !state.stopped && !state.pending &&
      (!executionAllowed(state) || Date.now() - state.verification.checkedAt > 3 * 86400000) &&
      benchmark?.status === 'passed') {
    try {
      const verification = await verifyExecution();
      await changeState(latest => {
        if (latest.lease?.id !== id || latest.stopped || latest.pending) return { unchanged: true };
        latest.verification = verification;
      });
      record.demoAuthorization = 'Signed Demo validation passed';
    } catch {
      record.demoAuthorization = 'Signed Demo validation unavailable';
    }
  }
  // Automatic cycles run the dated checks. Manual research remains a fast operation.
  const qa = automatic && qaDue(state.latestQA, now) ? runDemoQA(state.settings, now).catch(() => ({
    day, deployment: process.env.VERCEL_GIT_COMMIT_SHA, completedAt: timestamp(), status: 'degraded', error: 'Demo QA could not finish'
  })) : null;
  try {
    if (state.pending) {
      reconciliation = await resolvePending(state, id);
      await runAgent(record, names[3], { clientId: state.pending.clientId }, () => ({
        output: { reason: 'Reconciled an existing order reservation before further research' }
      }));
    } else {
      let feed = {};
      const marketTask = runAgent(record, names[0], { pairs: state.settings.pairs, interval: '15m' }, async setInput => {
        const results = await Promise.allSettled(state.settings.pairs.map(async pair => {
          const rows = await candles(pair);
          return [pair, rows, marketAnalyst(rows, state.strategy)];
        }));
        const valid = results.filter(result => result.status === 'fulfilled').map(result => result.value);
        feed = Object.fromEntries(valid.map(([pair, rows]) => [pair, rows]));
        setInput({ pairs: Object.keys(feed), interval: '15m',
          unavailable: state.settings.pairs.filter(pair => !feed[pair]),
          samples: Object.fromEntries(valid.map(([pair, rows]) => [pair, { size: rows.length, last: rows.at(-1)?.[6] }])) });
        if (!valid.length) throw Error('No Demo pair has usable market candles');
        return { output: Object.fromEntries(valid.map(([pair, , market]) => [pair, market])) };
      });
      const newsTask = runAgent(record, names[1], {}, setInput => newsAnalyst(id, setInput, state.latest[names[1]]));
      const [market, news] = await Promise.all([marketTask, newsTask]);
      let candidates = [];
      if (market.output) {
        const observed = settleForecasts(queued, feed);
        record.forecastResults = observed.resolved;
        queued = observed.remaining;
        managerDecision = managerDirective({
          markets:market.output,
          reports:state.latest[names[4]]?.output?.strategyLab ?? {},
          existingPositions:state.positions,
          sentiment:news.output?.sentiment ?? 'unknown'
        });
        candidates = Object.entries(market.output).filter(([, item]) => Date.now() - Date.parse(item.closedAt) < 960000)
          .map(([symbol, overview]) => {
            const position = state.positions[symbol];
            if (position) return { symbol, ...signal(overview, state.strategy, position), rule: position.rule ?? null };
            const at = Date.parse(overview.closedAt);
            const trials = entryCandidates(feed[symbol], overview, state.strategy).map(candidate => {
              const forecast = forecastAssessment(orderModel(state), symbol, feed[symbol], overview, state.strategy, now, candidate.rule);
              if (!queued.some(item => item.symbol === symbol && item.at === at && item.rule === candidate.rule)) {
                queued.push({ symbol, at, rule: candidate.rule, model: forecast.model ?? null,
                  probability: forecast.probability ?? null, paper: true });
              }
              return { ...candidate, forecast };
            }).sort((a, b) => Number(b.forecast.eligible) - Number(a.forecast.eligible) ||
              (b.forecast.probability ?? 0) - (a.forecast.probability ?? 0));
            const selected = trials[0];
            return selected ? { symbol, side: 'BUY', ...selected, testedRules: trials.map(item => item.rule) } :
              { symbol, side: 'HOLD', reason: 'No playbook entry condition was met', rule: null };
          }).sort((a, b) => (Number(b.side === 'SELL') - Number(a.side === 'SELL')) ||
            ((b.forecast?.probability ?? 0) - (a.forecast?.probability ?? 0)));
      }
      const strategyInput = {
        rules: state.strategy, playbook: playbookId,
        market: Object.fromEntries(Object.entries(market.output ?? {}).map(([symbol, item]) => [
          symbol, [item.direction, Number(item.rsi.toFixed(1)), Number((item.relativeVolume ?? 0).toFixed(1))] ])),
        candidates: candidates.map(({ symbol, side, rule }) => [symbol, side, rule]),
        holdings: Object.fromEntries(Object.entries(state.positions).map(([pair, position]) => [pair, { entry: position.price }])),
        sentiment: news.output?.sentiment ?? null,
        previousWeakness: state.latest[names[2]]?.output?.weakness?.slice(0, 120) ?? null
      };
      const strategyTask = runAgent(record, names[2], strategyInput, () => strategyReview(strategyInput, state, id, source));
      const learningDue = state.latestReviewDay !== day || state.latestReviewStrategy !== state.strategy.id ||
        state.latestReviewPlaybook !== playbookId;
      const learningTask = learningDue ? runAgent(record, names[4], {
        day, strategy: state.strategy.id, realizedUsd: state.realized, reviewedForecasts: state.lessons?.length ?? 0
      }, async () => {
        if (!market.output) throw Error('Demo candles unavailable for backtesting');
        const previous = [...(state.lessons ?? []), ...record.forecastResults];
        const neural = await modelReview({ ...state, lessons: previous }, id, feed, now);
        modelProposal = neural.proposal;
        review = {
          ...learningAgent(feed, state, id, timestamp()), neural: neural.report, strategyLab: neural.strategyLab, failures: state.feedback?.errors ?? [],
          losses: state.feedback?.losses ?? [], forecastSample: previous.length,
          forwardPaper: Object.fromEntries([...new Set(previous.map(item => item.rule).filter(Boolean))].map(rule => {
            const observations = previous.filter(item => item.rule === rule);
            return [rule, { observations: observations.length, positive: observations.filter(item => item.net > 0).length,
              meanNet: observations.reduce((sum, item) => sum + item.net, 0) / observations.length }];
          }))
        };
        return { output: review };
      }) : null;

      const strategy = await strategyTask;
      const verificationReady = Boolean(strategy.output && news.output?.sentiment &&
        (!(autonomyConfigured() || previewTrials) || benchmark?.sha === deployment && benchmark.status === 'passed'));
      const advisoryOK = verificationReady && news.output.sentiment !== 'negative';
      const plan = planTrades(state, candidates, market.output ?? {}, advisoryOK, { preview: previewTrials, verificationReady, now });
      const chosen = plan.find(item => item.manager.side !== 'HOLD');
      record.managerOrder = chosen ? { side: chosen.manager.side, symbol: chosen.symbol, rule: chosen.rule,
        reason: chosen.manager.reason, authority: 'General Manager', mode: chosen.mode } :
        { side: 'HOLD', authority: 'General Manager', reason: plan.find(item => item.side === 'BUY')?.manager?.reason ?? 'No eligible candidate' };
      manager = await runAgent(record, names[5], {
        candidates: candidates.length, sentiment: news.output?.sentiment ?? null, strategyReviewed: Boolean(strategy.output)
      }, () => ({ output: { orderPlan: plan.map(item => ({
        symbol: item.symbol, signal: item.side, action: item.manager.side, reason: item.manager.reason, mode: item.mode
      })) } }));
      const risk = await runAgent(record, names[3], { settings: state.settings, strategy: state.strategy.id }, async () => {
        if (!candidates.length) throw Error('Current Demo market data required');
        let dispatched = false;
        let preflightPassed = false;
        for (const candidate of plan) {
          const decision = { ...candidate, signal: candidate.side, side: candidate.manager.side,
            timestamp: timestamp(), strategy: state.strategy.id,
            commentary: candidate.manager.side === 'HOLD' ? candidate.manager.reason : explain(candidate) };
          if (decision.side === 'BUY') {
            decision.protectivePlan = protectivePlan({
              price: market.output[decision.symbol].price,
              notional: Math.min(inUsd(state.settings, 'maxPosition'), state.settings.capital),
              riskUsd: inUsd(state.settings, 'riskPerTrade'), volatilityPercent: market.output[decision.symbol].volatilityPercent
            });
          }
          record.decisions.push(decision);
          if (decision.side === 'HOLD') {
            decision.risk = { accepted: false, code: 'hold', reason: 'Manager chose to hold' };
          } else if (dispatched || preflightPassed) {
            decision.risk = { accepted: false, code: 'cycle-limit', reason: 'One order per research cycle' };
          } else {
            try {
              decision.risk = previewTrials && decision.mode === 'demo-trial' && decision.side === 'BUY' ?
                await previewTrialOrder({ symbol: candidate.symbol, decision, market: market.output[candidate.symbol], state }) :
                await evaluateOrder({ leaseId: id, symbol: candidate.symbol, decision, market: market.output[candidate.symbol], prerequisites: true });
            } catch (error) {
              const latest = await getState();
              decision.risk = { accepted: false, code: 'order-service', reason: errorText(error) };
              if (latest.pending) dispatched = true;
            }
          }
          if (decision.risk.clientId) dispatched = true;
          if (decision.risk.code === 'preview-validated') preflightPassed = true;
        }
        return { output: { evaluated: record.decisions.length, dispatchCount: Number(dispatched), preflightPassed } };
      });
      await learningTask;
      if (risk.error) record.error = risk.error;
      const latest = await getState();
      if (latest.pending) reconciliation = await resolvePending(latest, id);
      if (!market.output || !strategy.output || !news.output?.sentiment) {
        record.error ??= 'Required entry research services unavailable; exit evaluation remains independent';
      }
    }
  } catch (error) {
    record.error = errorText(error);
  }
  if (qa) {
    record.qa = await qa;
    if (benchmark) {
      record.qa.openAIQuality = benchmark.status;
      if (benchmark.status !== 'passed') record.qa.status = 'degraded';
    }
  }
  for (const name of names.slice(0, -1)) {
    if (!record.agents.some(row => row.agent === name)) {
      record.agents.push({
        agent: name, startedAt: record.startedAt, finishedAt: timestamp(), status: 'skipped',
        inputs: null, output: null, error: record.error ?? 'Scheduled review already completed or reconciliation-only cycle', usage: null
      });
    }
  }
  if (reconciliation) {
    try {
      const fill = applyFill(structuredClone(await getState()), reconciliation);
      if (fill) record.trades.push(fill);
    } catch (error) {
      record.error = errorText(error);
      reconciliation = null;
    }
  }
  const feedback = collectLessons(state.feedback, record);
  const report = managerReport(state, record, feedback);
  if (manager) manager.output = { ...report, ...manager.output, directive: managerDecision, demoOrderDirective: record.managerOrder };
  else manager = await runAgent(record, names[5], { day, strategy: state.strategy.id }, () => ({ output: report }));
  record.finishedAt = timestamp();
  await appendRun(id, record);
  await changeState(latest => {
    if (latest.lease?.id !== id || latest.lease.until <= Date.now()) throw Error('Research lease expired before journaling');
    if (reconciliation) applyFill(latest, reconciliation);
    for (const agent of record.agents) {
      if (agent.status !== 'skipped') latest.latest[agent.agent] = {
        run: id, at: agent.finishedAt, status: agent.status, output: agent.output, error: agent.error
      };
    }
    if (review) {
      latest.latestReviewDay = day;
      latest.latestReviewStrategy = latest.strategy.id;
      latest.latestReviewPlaybook = playbookId;
      if (review.proposal && !latest.proposal && review.proposal.parent === latest.strategy.id) latest.proposal = review.proposal;
      if (autonomyConfigured()) {
        latest.autonomousModel = modelProposal?.strategy === latest.strategy.id && benchmark?.status === 'passed' ?
          { ...modelProposal, source: 'authorized-fixed-playbook' } : null;
      } else if (modelProposal?.strategy === latest.strategy.id &&
          (!latest.modelProposal || Date.parse(latest.modelProposal.expiresAt) <= now)) {
        latest.modelProposal = modelProposal;
      }
    }
    latest.forecastQueue = queued.slice(-384);
    latest.lessons = [...(latest.lessons ?? []), ...record.forecastResults].slice(-512);
    if (benchmarkDue) latest.connectivityBenchmark = benchmark;
    latest.feedback = feedback;
    if (record.qa) latest.latestQA = record.qa;
    if (manager.output) {
      latest.managerReports ??= {};
      latest.managerReports[day] = manager.output;
      for (const old of Object.keys(latest.managerReports).sort().slice(0, -35)) delete latest.managerReports[old];
    }
    latest.head = id;
    latest.lease = null;
    latest.lastCycle = { status: record.error ? 'degraded' : 'completed', at: record.finishedAt, error: record.error };
    return latest.lastCycle;
  });
  return { id, status: record.error ? 'degraded' : 'completed', ...(record.qa ? { qa: record.qa.status } : {}),
    trialPreflight: record.decisions.some(decision => decision.risk?.code === 'preview-validated'),
    fills: record.trades.filter(fill => fill.quantity > 0).length };
}

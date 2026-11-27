import { randomUUID } from 'node:crypto';
import { executionAllowed, verifyExecution } from './orders.js';
import { append, changeState, scoped } from './store.js';
import { settingsRevision, validateSettings } from './settings.js';
import { runCycle } from './cycle.js';

export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function administer(body, admin) {
  const { id, action } = body;
  if (!operationId.test(id ?? '') || !['research', 'stop', 'resume', 'verify', 'settings', 'approve', 'reject', 'approve-model', 'reject-model', 'flatten'].includes(action)) {
    throw new RequestError(400, 'Invalid administrator operation');
  }
  if (action === 'research') return runCycle('admin', id);
  let settings;
  if (action === 'settings') {
    try { settings = validateSettings(body.settings); }
    catch (error) { throw new RequestError(400, error.message); }
  }
  const verification = action === 'verify' ? await verifyExecution() : null;
  return changeState(async state => {
    if (state.operations[id]) return { unchanged: true, value: { status: 'duplicate' } };
    const now = Date.now();
    for (const [key, value] of Object.entries(state.operations)) if (value.time < now - 86400000) delete state.operations[key];
    const recent = Object.values(state.operations).filter(entry => entry.time > now - 60000);
    if (action !== 'stop' && recent.length >= 12) throw new RequestError(429, 'Administrator operation rate limit reached');
    if (action !== 'stop' && state.lease?.until > now) throw new RequestError(409, 'A research cycle is running');
    let details = null;
    switch (action) {
      case 'stop':
        state.stopped = true;
        details = { pending: state.pending?.clientId ?? null };
        break;
      case 'flatten':   // emergency: stop new entries and close every protected trade on the next cycle (cancel exits, then market sell)
        state.stopped = true;
        for (const trade of Object.values(state.book ?? {})) { trade.forceExit = true; trade.deadline = 0; }
        details = { openTrades: Object.keys(state.book ?? {}).length };
        break;
      case 'resume':
        if (!executionAllowed(state) || state.pending) throw new RequestError(409, 'Verified production Demo deployment and clear order journal required');
        state.stopped = false;
        break;
      case 'verify':
        state.verification = verification;
        details = { expiresAt: new Date(verification.expires).toISOString() };
        break;
      case 'settings':
        if (state.pending) throw new RequestError(409, 'Reconcile pending orders before changing limits');
        if ([...Object.keys(state.positions), ...Object.values(state.book ?? {}).map(t => t.symbol)].some(pair => !settings.pairs.includes(pair))) {
          throw new RequestError(409, 'Retain pairs with tracked Demo positions');
        }
        details = { previous: state.settings, next: settings };
        state.settings = settings;
        state.settingsRevision = settingsRevision;
        break;
      case 'approve':
      case 'reject': {
        const proposal = state.proposal;
        if (!proposal || proposal.id !== body.proposal || proposal.parent !== state.strategy.id) {
          throw new RequestError(409, 'Strategy proposal is unavailable or stale');
        }
        if (action === 'approve' && (!state.stopped || state.pending)) {
          throw new RequestError(409, 'Stop execution and reconcile pending orders before approving a strategy');
        }
        details = { proposal, priorStrategy: state.strategy };
        if (action === 'approve') {
          state.strategy = proposal.strategy;
          state.activeModel = null;
          state.autonomousModel = null;
          state.modelProposal = null;
        }
        state.proposal = null;
        break;
      }
      case 'approve-model':
      case 'reject-model': {
        const proposal = state.modelProposal;
        if (!proposal || proposal.id !== body.proposal || proposal.strategy !== state.strategy.id ||
            !(Date.parse(proposal.expiresAt) > now)) throw new RequestError(409, 'Model proposal is unavailable or stale');
        if (action === 'approve-model' && (!state.stopped || state.pending)) {
          throw new RequestError(409, 'Stop execution and reconcile orders before approving a model');
        }
        details = { proposal: proposal.id, model: proposal.version, pairs: Object.keys(proposal.models) };
        if (action === 'approve-model') state.activeModel = { ...proposal, approvedAt: new Date(now).toISOString() };
        state.modelProposal = null;
        break;
      }
    }
    const audit = {
      id: randomUUID(), previous: state.auditHead, time: new Date(now).toISOString(), actor: 'admin',
      session: admin.id.slice(0, 16), action, requestId: id, details
    };
    await append(scoped('audit/' + audit.id + '.json'), audit);
    state.auditHead = audit.id;
    state.operations[id] = { time: now, action };
    return { status: 'applied' };
  });
}

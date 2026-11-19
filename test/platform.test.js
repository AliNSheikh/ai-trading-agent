import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, scryptSync } from 'node:crypto';
import dashboard from '../api/dashboard.js';
import session from '../api/session.js';
import control from '../api/control.js';
import research from '../api/research.js';
import cron from '../api/cron.js';
import demoHistory from '../api/demo-history.js';
import demoStatus from '../api/demo-status.js';
import { aiOpinion } from '../lib/ai.js';
import { defaults, periods } from '../lib/settings.js';
import { append, changeState, getState, scoped } from '../lib/store.js';

const config = { ...defaults, enabled: false, liveTradingEnabled: false, leverage: 1, maxPosition: 10 };
const storeRoot = '/repos/AliNSheikh/ai-trading-data/contents/';
const browserOrigin = 'https://demo-app.example';
const json = body => Response.json(body);
const etag = data => createHash('sha1').update(JSON.stringify(data)).digest('hex');
const sha = 'a'.repeat(40);

function fixture(t) {
  const files = new Map([
    ['config/defaults.json', config],
    ['journal/events.json', { events: [], trades: [] }]
  ]);
  const env = {
    ADMIN_PASSWORD_HASH: 'c'.repeat(32) + ':' + scryptSync('fixture-password', 'c'.repeat(32), 32).toString('hex'),
    GITHUB_DATA_TOKEN: 'fixture-github-key', BINANCE_DEMO_API_KEY: 'fixture-demo-key',
    BINANCE_DEMO_API_SECRET: 'fixture-demo-secret', OPENAI_API_KEY: 'fixture-openai-key', OPENAI_MODEL: 'gpt-4o-mini',
    VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: sha, CRON_SECRET: 'fixture-cron-key-long', DEMO_EXECUTION_ENABLED: 'true'
  };
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let failWrites = false;
  let newsError = false;
  let invalidAI = false;
  let gate = Promise.resolve();
  let apiDelay = null;
  let orderWrites = 0;
  const http = t.mock.method(globalThis, 'fetch', async (address, options) => {
    const url = new URL(address);
    assert.equal(options.redirect, 'error');
    if (url.origin === 'https://api.github.com') {
      assert.equal(options.headers.Authorization, 'Bearer fixture-github-key');
      if (url.pathname === '/repos/AliNSheikh/ai-trading-data') return json({ private: true, default_branch: 'main' });
      assert.ok(url.pathname.startsWith(storeRoot));
      const path = url.pathname.slice(storeRoot.length);
      const old = files.get(path);
      if (options.method === 'PUT') {
        const request = JSON.parse(options.body);
        if (failWrites) return new Response(null, { status: 403 });
        if (old && etag(old) !== request.sha || !old && request.sha) return new Response(null, { status: 409 });
        files.set(path, JSON.parse(Buffer.from(request.content, 'base64')));
        return json({});
      }
      if (!old) return new Response(null, { status: 404 });
      return json({ type: 'file', encoding: 'base64', sha: etag(old), content: Buffer.from(JSON.stringify(old)).toString('base64') });
    }

    if (url.origin === 'https://demo-api.binance.com') {
      if (url.pathname === '/api/v3/klines') {
        await gate;
        const end = Math.floor(Date.now() / 900000) * 900000;
        return json(Array.from({ length: 160 }, (_, index) => {
          const start = end - (160 - index) * 900000;
          const price = 100 + index * 0.05 + 3 * Math.sin(index / 8);
          return [start, price, price + 1, price - 1, price, 20, start + 899999];
        }));
      }
      if (url.pathname === '/api/v3/account') return json({ accountType: 'SPOT', canTrade: true, balances: [] });
      if (url.pathname === '/api/v3/ping') return json({});
      if (url.pathname === '/api/v3/order/test') return json({});
      if (url.pathname === '/api/v3/order' && options.method === 'POST') orderWrites++;
      throw Error('Unexpected Binance request');
    }
    if (url.origin === 'https://www.coindesk.com') {
      if (newsError) return new Response(null, { status: 502 });
      return new Response('<rss><channel><item><title>Bitcoin news fixture</title><link>https://www.coindesk.com/markets/example</link><pubDate>' +
        new Date(Date.now() - 1000).toUTCString() + '</pubDate></item></channel></rss>');
    }
    assert.equal(url.origin, 'https://api.openai.com');
    assert.equal(options.headers.Authorization, 'Bearer fixture-openai-key');
    if (url.pathname === '/v1/models/gpt-4o-mini') return json({ id: 'gpt-4o-mini' });
    assert.equal(url.pathname, '/v1/chat/completions');
    assert.doesNotMatch(options.body, /fixture-(github|demo|openai|cron)-/);
    if (apiDelay) await apiDelay;
    const request = JSON.parse(options.body);
    assert.equal(request.tools, undefined);
    assert.equal(request.max_completion_tokens, 450);
    const reply = request.messages[0].content.startsWith('Assess')
      ? { sentiment: 'neutral', explanation: 'Fixture sentiment' } : { explanation: 'Fixture explanation', weakness: 'Fixture weakness' };
    if (invalidAI) return new Response(null, { status: 503 });
    return json({ usage: { prompt_tokens: 121, completion_tokens: 35 },
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] });
  });

  return { files, http, failWrites: value => { failWrites = value; }, newsError: value => { newsError = value; },
    invalidAI: value => { invalidAI = value; }, setGate: value => { gate = value; },
    apiDelay: value => { apiDelay = value; }, orderWrites: () => orderWrites };
}

async function request(handler, { method = 'GET', body, headers = {}, query, ip = '192.0.2.1' } = {}) {
  const response = {
    code: 200, headers: {},
    status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(value) { this.body = value; return this; },
    end(value) { this.body = value; return this; }
  };
  const req = { method, body, query, headers: { host: 'demo-app.example', origin: browserOrigin,
    'content-type': 'application/json', ...headers }, socket: { remoteAddress: ip } };
  await handler(req, response);
  return response;
}

async function signedIn(ip) {
  const result = await request(session, { method: 'POST', body: { action: 'login', password: 'fixture-password' }, ip });
  assert.equal(result.code, 200);
  assert.match(result.headers['Set-Cookie'], /Secure; HttpOnly; SameSite=Strict/);
  const cookie = result.headers['Set-Cookie'].split(';')[0];
  const overview = await request(control, { headers: { cookie }, ip });
  assert.equal(overview.code, 200);
  return { cookie, 'x-csrf-token': overview.body.csrf };
}

const mutation = (headers, action, extra = {}) => request(control, {
  method: 'POST', headers, body: { id: randomUUID(), action, ...extra }
});

test('all private routes reject unauthenticated access and root shows a CSP-protected sign-in form', async t => {
  fixture(t);
  for (const handler of [control, research, demoStatus, demoHistory, cron]) {
    assert.equal((await request(handler)).code, 401);
  }
  const root = await request(dashboard);
  assert.equal(root.code, 401);
  assert.match(root.body, /Administrator password/);
  assert.match(root.body, /method="post"/);
  assert.doesNotMatch(root.body, /Emergency stop/);
  assert.match(root.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(root.headers['Content-Security-Policy'], /'nonce-/);
  assert.equal(root.headers['Cache-Control'], 'private, no-store');
});

test('persistent login rate limits, CSRF protection, session expiry and logout fail closed', async t => {
  const data = fixture(t);
  const cross = await request(session, { method: 'POST', headers: { origin: 'https://foreign.example' },
    body: { action: 'login', password: 'fixture-password' } });
  assert.equal(cross.code, 403);
  for (let i = 0; i < 6; i++) {
    assert.equal((await request(session, { method: 'POST', body: { action: 'login', password: 'wrong' }, ip: '192.0.2.40' })).code, 401);
  }
  assert.equal((await request(session, {
    method: 'POST', body: { action: 'login', password: 'fixture-password' }, ip: '192.0.2.40'
  })).code, 429);
  const headers = await signedIn('192.0.2.41');
  assert.equal((await request(dashboard, { headers })).code, 200);
  assert.equal((await mutation({ cookie: headers.cookie }, 'stop')).code, 403);
  assert.equal((await mutation({ ...headers, origin: 'https://foreign.example' }, 'stop')).code, 403);
  assert.equal((await mutation(headers, 'stop')).code, 200);
  assert.equal((await request(session, { method: 'POST', headers, body: { action: 'logout' } })).code, 200);
  assert.equal((await request(control, { headers })).code, 401);
  const newHeaders = await signedIn('192.0.2.42');
  const document = data.files.get(scoped('auth.json'));
  Object.values(document.sessions).forEach(value => { value.expires = 0; });
  assert.equal((await request(control, { headers: newHeaders })).code, 401);
  data.failWrites(true);
  const failed = await request(session, { method: 'POST', body: { action: 'login', password: 'fixture-password' }, ip: '192.0.2.43' });
  assert.equal(failed.code, 503);
  assert.equal(failed.headers['Set-Cookie'], undefined);
});

test('GitHub CAS retries divergent writes and immutable records deduplicate', async t => {
  fixture(t);
  await changeState(state => { state.realized = 0; });
  await Promise.all([
    changeState(state => { state.realized += 1; }),
    changeState(state => { state.realized += 2; })
  ]);
  assert.equal((await getState()).realized, 3);
  const path = scoped('runs/deduplicate.json');
  await append(path, { id: 'deduplicate', result: 'first' });
  await append(path, { id: 'deduplicate', result: 'first' });
  await assert.rejects(append(path, { id: 'deduplicate', result: 'changed' }), /Concurrent/);
});

test('authenticated cycle journals all agents, budgets usage and deduplicates overlapping and repeated jobs', async t => {
  const f = fixture(t);
  const headers = await signedIn('192.0.2.51');
  let release;
  f.setGate(new Promise(resolve => { release = resolve; }));
  const body = { action: 'research', id: randomUUID() };
  const first = request(control, { method: 'POST', headers, body });
  for (let attempt = 0; attempt < 30 && !(await getState()).lease; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok((await getState()).lease);
  assert.equal((await mutation(headers, 'research')).code, 409);
  assert.equal((await mutation(headers, 'stop')).code, 200);
  release();
  assert.equal((await first).body.status, 'completed');
  assert.deepEqual((await request(control, { method: 'POST', headers, body })).body, { status: 'duplicate' });
  const overview = (await request(control, { headers })).body;
  const journal = (await request(research, { headers })).body;
  assert.equal(journal.items.length, 1);
  assert.equal(journal.items[0].agents.length, 5);
  assert.equal(overview.ai.requests, 2);
  assert.equal(overview.ai.input, 242);
  assert.equal(overview.ai.unconfirmed, 0);
  assert.equal(overview.execution, false);
  assert.equal(overview.liveTrading, false);
  assert.equal(overview.withdrawals, false);
  assert.equal(f.orderWrites(), 0);
  assert.doesNotMatch(JSON.stringify(journal), /fixture-(github|demo|openai|cron)-/);
  assert.equal((await request(research, { headers, query: { kind: 'audit' } })).body.items[0].action, 'stop');
});

test('strategy changes need administrator approval, preview cannot resume and invalid scheduling auth is rejected', async t => {
  fixture(t);
  const headers = await signedIn('192.0.2.71');
  const proposal = { id: 'p-1', parent: 'sma-rsi-v1', strategy: { id: 'sma-rsi-v2', fast: 10, slow: 30, minRsi: 50, maxRsi: 68 } };
  await changeState(state => { state.proposal = proposal; });
  assert.equal((await mutation(headers, 'approve', { proposal: 'stale' })).code, 409);
  assert.equal((await getState()).strategy.id, 'sma-rsi-v1');
  assert.equal((await mutation(headers, 'approve', { proposal: proposal.id })).code, 200);
  assert.equal((await getState()).strategy.id, 'sma-rsi-v2');
  assert.equal((await mutation(headers, 'verify')).code, 200);
  assert.equal((await mutation(headers, 'resume')).code, 409);
  assert.equal((await request(cron, { headers: { authorization: 'Bearer fixture-cron-key-long' } })).code, 401);
  process.env.VERCEL_ENV = 'production';
  assert.equal((await request(cron, { headers: { authorization: 'Bearer incorrect' } })).code, 401);
});

test('missing news and provider ambiguity retain spending reservations and prevent order processing', async t => {
  const f = fixture(t);
  const headers = await signedIn('192.0.2.81');
  f.invalidAI(true);
  const response = await mutation(headers, 'research');
  assert.equal(response.body.status, 'degraded');
  const state = await getState();
  assert.equal(state.pending, null);
  const { month } = periods();
  assert.equal(state.ai[month].unconfirmed, 1);
  assert.ok(state.ai[month].usd > 0);
  await changeState(current => {
    current.settings.aiMonthlyUsd = 0;
    current.lease = { id: 'test-budget', until: Date.now() + 30000 };
  });
  await assert.rejects(aiOpinion('Assess', {}, 'test-budget'), /budget exhausted/);
  assert.equal(f.orderWrites(), 0);
});

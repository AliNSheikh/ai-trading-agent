import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { BASE, checkDemoOrder, demo, submitOrder } from '../lib/demo.js';

const order = { symbol: 'BTCUSDT', side: 'BUY', amount: '10', clientId: 'ta-' + '1'.repeat(28) };

test('Demo denies unauthorized methods, live URLs and non-Spot endpoints before fetch', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected network call'); });
  for (const path of ['/api/v3/order', '/api/v3/order/test', '/fapi/v1/order', '/sapi/v1/margin/order',
    '/sapi/v1/capital/withdraw/apply', '/sapi/v1/asset/transfer', 'https://api.binance.com/api/v3/order',
    '//api.binance.com/api/v3/klines']) {
    await assert.rejects(demo(path), /prohibited/);
  }
  await assert.rejects(demo('/api/v3/order', { symbol: 'BTCUSDT', origClientOrderId: 'manual-order' }, true), /prohibited/);
  await assert.rejects(demo('/api/v3/klines', { symbol: 'BTCUSD_PERP' }), /prohibited/);
  const env = ['VERCEL_ENV', 'DEMO_EXECUTION_ENABLED'];
  const original = env.map(key => process.env[key]);
  process.env.VERCEL_ENV = 'preview';
  process.env.DEMO_EXECUTION_ENABLED = 'true';
  t.after(() => env.forEach((key, index) => {
    if (original[index] === undefined) delete process.env[key];
    else process.env[key] = original[index];
  }));
  assert.throws(() => submitOrder(order), /gate is closed/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(BASE, 'https://demo-api.binance.com');
});

test('connectivity check validates a signed test order without dispatching a filled order', async t => {
  process.env.BINANCE_DEMO_API_KEY = 'unit-test-key';
  process.env.BINANCE_DEMO_API_SECRET = 'unit-test-secret';
  t.after(() => {
    delete process.env.BINANCE_DEMO_API_KEY;
    delete process.env.BINANCE_DEMO_API_SECRET;
  });
  const fetch = t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url.origin, BASE);
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/api/v3/ping') {
      assert.equal(options.headers['X-MBX-APIKEY'], undefined);
      return Response.json({});
    }
    assert.equal(options.headers['X-MBX-APIKEY'], 'unit-test-key');
    const params = new URLSearchParams(url.search);
    const signature = params.get('signature');
    params.delete('signature');
    assert.equal(signature, createHmac('sha256', 'unit-test-secret').update(params.toString()).digest('hex'));
    if (url.pathname === '/api/v3/account') return Response.json({ accountType: 'SPOT', balances: [], canTrade: true });
    assert.equal(url.pathname, '/api/v3/order/test');
    assert.equal(options.method, 'POST');
    assert.equal(url.searchParams.get('symbol'), 'BTCUSDT');
    assert.equal(url.searchParams.get('quoteOrderQty'), '10');
    assert.equal(url.searchParams.get('type'), 'MARKET');
    return Response.json({});
  });
  await checkDemoOrder();
  assert.equal(fetch.mock.callCount(), 3);
});

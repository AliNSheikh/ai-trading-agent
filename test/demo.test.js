import {test} from 'node:test';import assert from 'node:assert/strict';import {BASE,demo} from '../lib/demo.js';
test('fixed demo host',()=>assert.equal(BASE,'https://demo-api.binance.com'));
test('reject order and withdrawal endpoints before network access',async()=>{await assert.rejects(demo('/api/v3/order'),/prohibited/);await assert.rejects(demo('/sapi/v1/capital/withdraw/apply'),/prohibited/);});

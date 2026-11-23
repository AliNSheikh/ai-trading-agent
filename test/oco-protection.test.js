import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDemoOco,verifyDemoOco} from '../lib/oco-protection.js';
test('native OCO draft has a stop below and target above entry, with risk budget',()=>{
 const draft=prepareDemoOco({symbol:'BTCUSDT',entryPrice:100,quantity:.1,volatilityPercent:1,riskUsd:.5,tickSize:.01,stepSize:.001,minNotional:5});
 assert.equal(draft.status,'ready-for-demo-validation');
 assert.equal(draft.submitted,false);
 assert.equal(draft.verified,false);
 assert.ok(Number(draft.params.belowStopPrice)<100);
 assert.ok(Number(draft.params.abovePrice)>100);
 assert.ok(draft.plan.estimatedLossUsd<=.5);
 assert.equal(verifyDemoOco({request:draft,exchangeResponse:{}}).verified,false);
});
test('OCO drafts fail closed for minimum notional or oversized estimated loss',()=>{
 const common={symbol:'ETHUSDT',entryPrice:100,quantity:.1,volatilityPercent:2,riskUsd:.5,tickSize:.01,stepSize:.001};
 assert.equal(prepareDemoOco({...common,minNotional:20}).status,'rejected');
 assert.equal(prepareDemoOco({...common,minNotional:5,riskUsd:.05}).status,'rejected');
 assert.throws(()=>prepareDemoOco({...common,symbol:'BTCUPUSDT',tickSize:0,minNotional:5}),/Invalid/);
});

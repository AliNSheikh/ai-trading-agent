import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, authorizedSettings } from '../lib/settings.js';
import { entryDiagnostics } from '../lib/entry-diagnostics.js';

test('default $100 conservative risk and no model are reported without bypassing safeguards', () => {
 const state={settings:defaults,strategy:{id:'sma-rsi-v1'},stopped:false,pending:null,verification:{expires:Date.now()+86400000},managerReports:{},latest:{}};
 const result=entryDiagnostics(state,{minNotional:5});
 assert.equal(result.safeToOpenNewPositions,false);
 assert.ok(result.blockers.some(b=>b.code==='model'));
 assert.ok(result.blockers.some(b=>b.code==='notional'));
 assert.equal(result.maximumEntryNotionalUsd,0.5);
});
test('automated release does not widen administrator-defined limits or pairs',()=>{
 const result=authorizedSettings(defaults);
 assert.equal(result.maxTrades,3);
 assert.deepEqual(result.riskPerTrade,{mode:'percent',value:0.5});
 assert.deepEqual(result.pairs,['BTCUSDT','ETHUSDT','SOLUSDT']);
});

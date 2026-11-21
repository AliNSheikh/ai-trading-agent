import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tradeExamples,walkForward,managerDirective} from '../lib/strategy-lab.js';
import {protectivePlan,requiresExchangeProtection} from '../lib/protective-plan.js';
import {defaultStrategy} from '../lib/settings.js';

const bars=Array.from({length:1200},(_,i)=>{const t=Date.UTC(2026,0,1)+i*900000;const p=100+i*.03+Math.sin(i/9)*1.4;return [t,p,p+1,p-1,p,150+Math.cos(i/4)*30,t+899999];});
test('walk-forward cannot approve entries without independent holdout',()=>{
 const r=walkForward(bars,defaultStrategy);
 assert.ok(['research-qualified','insufficient-evidence'].includes(r.status));
 assert.equal(r.eligibleForExecution,false);
 assert.ok(r.training.length>=4);
});
test('signals use prior closed candles, not future entry and exit data',()=>{
 const original=tradeExamples(bars,defaultStrategy);
 const modified=bars.map(r=>[...r]);
 modified[modified.length-1][1]*=4;
 assert.ok(tradeExamples(modified,defaultStrategy).every(x=>Number.isFinite(x.netUsd)));
 assert.equal(original.filter(x=>x.at<bars.at(-12)[6]).length,
   tradeExamples(modified,defaultStrategy).filter(x=>x.at<bars.at(-12)[6]).length);
});
test('general manager cannot turn research into an unprotected buy',()=>{
 const r=managerDirective({markets:{BTCUSDT:{direction:'UP',rsi:60}},reports:{BTCUSDT:{status:'research-qualified',selectedRule:'trend'}}});
 assert.equal(r.priority.side,'WATCH');
 assert.equal(r.priority.eligible,true);
});
test('protective risk estimates fees and does not pretend stops are guaranteed',()=>{
 const p=protectivePlan({price:100,notional:10,riskUsd:.5,volatilityPercent:1,feeRate:.002});
 assert.equal(p.status,'planned');
 assert.ok(p.estimatedLossUsd<=.5);
 assert.equal(p.protectedOnExchange,false);
 assert.equal(requiresExchangeProtection({plan:p,exchangeOrder:null}),false);
 assert.throws(()=>protectivePlan({price:-1,notional:10,riskUsd:.5,volatilityPercent:1}),/Invalid/);
});

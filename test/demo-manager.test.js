import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoManagerCommand} from '../lib/demo-manager.js';
const good={direction:'UP',rsi:60,relativeVolume:1.8,volatilityPercent:.7};
test('manager chooses highest quality candidate and explains its decision',()=>{
 const result=demoManagerCommand({markets:{BTCUSDT:good,ETHUSDT:{...good,relativeVolume:1.2}},
   candidates:[{symbol:'ETHUSDT',side:'BUY',rule:'trend',reason:'trend'},{symbol:'BTCUSDT',side:'BUY',rule:'breakout',reason:'confirmed breakout'}],
   news:'neutral',strategyReady:true,benchmarkPassed:true});
 assert.equal(result.side,'BUY');
 assert.equal(result.symbol,'BTCUSDT');
 assert.equal(result.rule,'breakout');
 assert.match(result.reason,/confirmed breakout/);
});
test('manager refuses trades during risk stop, pending orders or negative news',()=>{
 const input={markets:{BTCUSDT:good},candidates:[{symbol:'BTCUSDT',side:'BUY',rule:'breakout',reason:'test'}],
   news:'neutral',strategyReady:true,benchmarkPassed:true};
 assert.equal(demoManagerCommand({...input,stopped:true}).side,'HOLD');
 assert.equal(demoManagerCommand({...input,hasPending:true}).side,'HOLD');
 assert.equal(demoManagerCommand({...input,news:'negative'}).side,'HOLD');
 assert.equal(demoManagerCommand({...input,benchmarkPassed:false}).side,'HOLD');
});

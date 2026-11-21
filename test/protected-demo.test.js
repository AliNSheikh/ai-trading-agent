import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../lib/settings.js';
import {protectedQuote} from '../lib/protected-demo.js';
import {placeDemoOpoco,demoOrderList,BASE} from '../lib/demo.js';

const tick={bidPrice:'99.99',askPrice:'100.00'};
const info={minimum:5,minQty:.001,maxQty:100,step:.001,tickSize:.01,opocoAllowed:true};
const wallet={canTrade:true,balances:[{asset:'USDT',free:'100'}]};
const market={price:100,volatilityPercent:1,closedAt:new Date().toISOString()};
const state=()=>({stopped:false,pending:null,positions:{},days:{},months:{},realized:0});
function configure(t){
 const vars={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),DEMO_EXECUTION_ENABLED:'true',
   DEMO_AUTONOMOUS_ENABLED:'true',DEMO_BRACKET_ENABLED:'true',BINANCE_DEMO_API_KEY:'fixture-demo-only-key',
   BINANCE_DEMO_API_SECRET:'fixture-demo-only-secret'};
 const old=Object.fromEntries(Object.keys(vars).map(x=>[x,process.env[x]]));Object.assign(process.env,vars);
 t.after(()=>{for(const [k,v]of Object.entries(old)){if(v==null)delete process.env[k];else process.env[k]=v;}});
}
test('Demo OPOCO sizing respects exchange minimum and $0.50 risk estimate',t=>{
 configure(t);
 const quote=protectedQuote({settings:defaults,state:state(),market,wallet,filters:info,ticker:tick});
 assert.equal(quote.accepted,true,JSON.stringify(quote));
 assert.ok(quote.notional<=10);
 assert.ok(quote.notional>=5);
 assert.ok(Number(quote.stopPrice)<100);
 assert.ok(Number(quote.targetPrice)>100);
 assert.ok(quote.expectedWorstUsd<=.5);
});
test('fails closed on unsupported order list and insufficient notional',t=>{
 configure(t);
 assert.equal(protectedQuote({settings:defaults,state:state(),market,wallet,filters:{...info,opocoAllowed:false},ticker:tick}).code,'unsupported');
 assert.equal(protectedQuote({settings:{...defaults,maxPosition:{mode:'usd',value:4}},state:state(),market,wallet,filters:info,ticker:tick}).code,'minimum');
 const s=state();s.days[new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now())]={experimental:1};
 assert.equal(protectedQuote({settings:defaults,state:s,market,wallet,filters:info,ticker:tick}).code,'training-cap');
});
test('only Demo hostname receives native linked OPOCO with no withdrawals or live requests',async t=>{
 configure(t);
 let count=0;
 t.mock.method(globalThis,'fetch',async (input,options)=>{
   const u=new URL(input);
   assert.equal(u.origin,BASE);
   assert.equal(u.pathname,'/api/v3/orderList/opoco');
   assert.equal(options.method,'POST');
   assert.equal(u.searchParams.get('workingType'),'LIMIT');
   assert.equal(u.searchParams.get('workingSide'),'BUY');
   assert.equal(u.searchParams.get('pendingSide'),'SELL');
   assert.equal(u.searchParams.get('pendingAboveType'),'LIMIT_MAKER');
   assert.equal(u.searchParams.get('pendingBelowType'),'STOP_LOSS');
   assert.equal(u.searchParams.get('workingTimeInForce'),'FOK');
   assert.equal(u.searchParams.get('pendingQuantity'),null);
   count++;
   return Response.json({symbol:'BTCUSDT',listClientOrderId:'tl-'+'b'.repeat(28),orderListId:123,orders:[]});
 });
 const response=await placeDemoOpoco({symbol:'BTCUSDT',listClientOrderId:'tl-'+'b'.repeat(28),
   workingClientOrderId:'ta-'+'c'.repeat(28),workingPrice:'100.00',
   workingQuantity:'.09000000',abovePrice:'102.00',belowStopPrice:'98.00'});
 assert.equal(response.orderListId,123);
 assert.equal(count,1);
 await assert.rejects(placeDemoOpoco({symbol:'BTCUSDT',listClientOrderId:'tl-'+'b'.repeat(28),
   workingClientOrderId:'ta-'+'c'.repeat(28),workingPrice:'100',workingQuantity:'0.1',
   abovePrice:'99',belowStopPrice:'98'}),/pricing invalid/);
});

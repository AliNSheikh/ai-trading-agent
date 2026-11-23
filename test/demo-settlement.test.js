import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveProtectedDemo,applyProtectedFill} from '../lib/protected-demo.js';
import {periods} from '../lib/settings.js';
const listId='tl-'+'b'.repeat(28);
const pending={kind:'opoco',status:'dispatching',listId,clientId:'ta-'+'c'.repeat(28),
 symbol:'BTCUSDT',strategy:'sma-test',rule:'trend',reason:'Demo test',time:new Date().toISOString(),
 quote:{expectedWorstUsd:.3}};
function mockAccount(t,handler){
 const env={BINANCE_DEMO_API_KEY:'fixture-demo',BINANCE_DEMO_API_SECRET:'fixture-secret'};
 const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const [k,v] of Object.entries(old))if(v==null)delete process.env[k];else process.env[k]=v;});
 t.mock.method(globalThis,'fetch',async url=>{
  const u=new URL(url);assert.equal(u.origin,'https://demo-api.binance.com');
  return Response.json(handler(u));
 });
}
test('completed native Demo list settles entry/exit fees exactly once',async t=>{
 const now=Date.now();
 mockAccount(t,u=>{
  if(u.pathname==='/api/v3/orderList')return {symbol:'BTCUSDT',listClientOrderId:listId,orderListId:123,
    listOrderStatus:'ALL_DONE',orders:[{orderId:1},{orderId:2},{orderId:3}]};
  if(u.pathname==='/api/v3/order'){
    const id=Number(u.searchParams.get('orderId'));
    return {symbol:'BTCUSDT',orderId:id,side:id===1?'BUY':'SELL',
     status:id===3?'CANCELED':'FILLED',executedQty:id===3?'0':'0.09',
     cummulativeQuoteQty:id===1?'9.00':id===2?'9.18':'0',
     price:id===1?'100':'102',updateTime:now};
  }
  if(u.pathname==='/api/v3/myTrades'){
   const id=Number(u.searchParams.get('orderId'));
   return [{orderId:id,symbol:'BTCUSDT',qty:'0.09',quoteQty:id===1?'9':'9.18',
     commission:'0.001',commissionAsset:'USDT',price:id===1?'100':'102'}];
  }
  throw Error('Unexpected endpoint');
 });
 const fill=await resolveProtectedDemo(pending);
 assert.equal(fill.status,'CLOSED');
 assert.ok(Math.abs(fill.netProfit-.178)<1e-6);
 const state={pending:{...pending},days:{},months:{},positions:{},realized:0};
 applyProtectedFill(state,fill);
 assert.equal(state.pending,null);
 assert.equal(state.performance.closed,1);
 assert.ok(Math.abs(state.realized-.178)<1e-6);
 const {day}=periods(now);
 assert.equal(state.days[day].trades,1);
});
test('active native OPOCO remains pending while protective exits are active',async t=>{
 mockAccount(t,u=>{
  if(u.pathname==='/api/v3/orderList')return {symbol:'BTCUSDT',listClientOrderId:listId,
    orderListId:123,listOrderStatus:'EXECUTING',orders:[{orderId:1},{orderId:2},{orderId:3}]};
  throw Error('Unexpected endpoint');
 });
 assert.equal(await resolveProtectedDemo({...pending,entryObserved:true,entryFill:{quantity:0.01}}),null);
});

test('active bracket journals its verified entry once while preserving protection',async t=>{
 const now=Date.now();
 mockAccount(t,u=>{
  if(u.pathname==='/api/v3/orderList')return {symbol:'BTCUSDT',listClientOrderId:listId,
    orderListId:123,listOrderStatus:'EXECUTING',orders:[{orderId:1},{orderId:2},{orderId:3}]};
  if(u.pathname==='/api/v3/order')return {symbol:'BTCUSDT',clientOrderId:pending.clientId,
    status:'FILLED',side:'BUY',orderId:1,executedQty:'0.01',cummulativeQuoteQty:'1.45',updateTime:now};
  throw Error('Unexpected endpoint');
 });
 const fill=await resolveProtectedDemo(pending);
 assert.equal(fill.status,'ENTRY_FILLED');
 const state={pending:{...pending},days:{},months:{},positions:{},realized:0};
 applyProtectedFill(state,fill);
 applyProtectedFill(state,fill);
 assert.equal(state.days[periods(now).day].trades,1);
 assert.equal(state.pending.entryObserved,true);
 assert.equal(await resolveProtectedDemo(state.pending),null);
});

test('base commission reduces sale quantity without a second cash charge',async t=>{
 const now=Date.now();
 mockAccount(t,u=>{
  if(u.pathname==='/api/v3/orderList')return {symbol:'BTCUSDT',listClientOrderId:listId,orderListId:123,
    listOrderStatus:'ALL_DONE',orders:[{orderId:1},{orderId:2}]};
  const id=Number(u.searchParams.get('orderId'));
  const qty=id===1?'0.09':'0.089';
  const quote=id===1?'9':'9.078';
  if(u.pathname==='/api/v3/order')return {symbol:'BTCUSDT',orderId:id,side:id===1?'BUY':'SELL',
    status:'FILLED',executedQty:qty,cummulativeQuoteQty:quote,updateTime:now};
  if(u.pathname==='/api/v3/myTrades')return [{orderId:id,symbol:'BTCUSDT',qty,quoteQty:quote,
    commission:'0.001',commissionAsset:id===1?'BTC':'USDT',price:id===1?'100':'102'}];
  throw Error('Unexpected endpoint');
 });
 const fill=await resolveProtectedDemo(pending);
 assert.ok(Math.abs(fill.netProfit-.077)<1e-6);
 assert.ok(Math.abs(fill.feeUsd-.101)<1e-6);
});

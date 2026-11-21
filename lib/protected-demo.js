import { createHash } from 'node:crypto';
import { demo, account, rules, deploymentCanTrade, demoOrderList, placeDemoOpoco, bookTicker } from './demo.js';
import { inUsd, periods } from './settings.js';
import { protectivePlan } from './protective-plan.js';
import { changeState, getState } from './store.js';
import { currentVerification } from './risk.js';

const floorTo=(v,step)=>Math.floor(v/step+1e-9)*step;
const ceilTo=(v,step)=>Math.ceil(v/step-1e-9)*step;
const fixed=x=>Number(x.toFixed(8)).toFixed(8);
const invalid=(code,reason)=>({accepted:false,code,reason});
export function protectedDemoEnabled() {
 return deploymentCanTrade() && process.env.DEMO_AUTONOMOUS_ENABLED==='true' &&
   process.env.DEMO_BRACKET_ENABLED==='true';
}

export function protectedQuote({settings,state,market,wallet,filters,ticker,now=Date.now()}) {
 if(!settings || !state || !market || !wallet || !filters || !ticker) return invalid('inputs','Missing verified Demo market input');
 if(state.stopped || state.pending || !protectedDemoEnabled())return invalid('disabled','Demo protection or execution disabled');
 if(!filters.opocoAllowed) return invalid('unsupported','Binance Demo symbol does not support native OPOCO protection');
 if(wallet.canTrade!==true) return invalid('account','Demo account cannot trade Spot');
 const {day,month}=periods(now);
 const daily=state.days?.[day]??{orders:0,trades:0,volume:0,loss:0};
 const monthLoss=state.months?.[month]?.loss??0;
 const openPositions=Object.values(state.positions??{});
 // Legacy open positions have not been reconciled against native exchange protection.
 if(openPositions.length)return invalid('exposure','Unreconciled or older positions require protection review');
 if((daily.orders??daily.trades??0)>=Math.min(settings.maxTrades,3))return invalid('daily-cap','Demo daily order cap reached');
 const ask=Number(ticker.askPrice),bid=Number(ticker.bidPrice);
 if(!Number.isFinite(ask)||!Number.isFinite(bid)||ask<=0||bid<=0||bid>ask ||
    (ask-bid)/ask>.003)return invalid('spread','Demo bid/ask is unavailable or spread exceeds 0.3%');
 if(Math.abs(ask/market.price-1)>.015)return invalid('market-deviation','Demo quote moved more than 1.5% from latest closed candle');
 const price=ceilTo(ask*1.001,filters.tickSize);
 if(!Number.isFinite(price)||price<=0)return invalid('price','Demo price filter unavailable');
 const budget=Math.min(settings.capital, inUsd(settings,'maxPosition'),
   inUsd(settings,'dailyVolume')-(daily.volume??0), Number(wallet.balances?.find(b=>b.asset==='USDT')?.free??0));
 const quantity=floorTo(budget/price/1.003,filters.step);
 const notional=quantity*price;
 if(!Number.isFinite(quantity)||quantity<filters.minQty||quantity>filters.maxQty ||
    notional<filters.minimum*1.005)return invalid('minimum','Safe order budget is below the verified Binance Demo minimum');
 const riskUsd=inUsd(settings,'riskPerTrade');
 const volatility=Number(market.volatilityPercent);
 if(!Number.isFinite(volatility)||volatility<0)return invalid('volatility','Market volatility unavailable');
 const plan=protectivePlan({price,notional,riskUsd,volatilityPercent:volatility,feeRate:.002});
 if(plan.status!=='planned')return invalid('risk','Protective stop plus fees exceed the per-trade risk allocation');
 // Reserve additional slippage room. This is an estimate, never a guaranteed loss ceiling.
 const expectedWorst=plan.estimatedLossUsd+notional*.005;
 if(expectedWorst>riskUsd || (daily.loss??0)+expectedWorst>inUsd(settings,'dailyLoss') ||
    monthLoss+expectedWorst>inUsd(settings,'monthlyLoss'))
   return invalid('risk','Estimated risk, including slippage reserve, breaches loss limits');
 const stop=floorTo(plan.stopPrice,filters.tickSize);
 const target=ceilTo(plan.targetPrice,filters.tickSize);
 if(!(stop>0&&stop<bid&&target>ask&&stop*quantity>=filters.minimum))
   return invalid('filters','Protective stop or target does not satisfy exchange price/notional limits');
 return {accepted:true,code:'demo-protected-entry',amount:fixed(quantity),notional,
   quoteLimit:fixed(price),stopPrice:fixed(stop),targetPrice:fixed(target),
   expectedWorstUsd:expectedWorst,expectedLossUsd:plan.estimatedLossUsd,
   minimum:filters.minimum,riskUsd,reason:'Demo-only exploratory entry with native linked OPOCO exits; stop price is not guaranteed'};
}

export async function dispatchProtectedDemo({leaseId,symbol,decision,market,verified,fingerprint}) {
 if(!decision.training || decision.side!=='BUY'||!protectedDemoEnabled()||!verified)
   return invalid('disabled','Demo training is not enabled or not verified');
 const state=await getState();
 if(state.stopped||state.pending)return invalid('busy','Demo execution unavailable or pending');
 const [wallet,filters,ticker]=await Promise.all([account(),rules(symbol),bookTicker(symbol)]);
 const quote=protectedQuote({settings:state.settings,state,market,wallet,filters,ticker});
 if(!quote.accepted)return quote;
 const clientId='ta-'+createHash('sha256').update(leaseId+':opoco:'+symbol).digest('hex').slice(0,28);
 const listId='tl-'+createHash('sha256').update(leaseId+':list:'+symbol).digest('hex').slice(0,28);
 const reservation=await changeState(current=>{
   if(current.lease?.id!==leaseId||current.lease.until<=Date.now()||current.stopped||current.pending||
     !currentVerification(current,fingerprint)||!protectedDemoEnabled())
     return {unchanged:true,value:invalid('lease','Demo safety lease not valid')};
   const currentQuote=protectedQuote({settings:current.settings,state:current,market,wallet,filters,ticker});
   if(!currentQuote.accepted)return {unchanged:true,value:currentQuote};
   const {day}=periods();
   const daily=current.days[day]??={volume:0,trades:0,loss:0,orders:0};
   daily.orders=(daily.orders??daily.trades??0)+1;
   current.pending={kind:'opoco',status:'dispatching',clientId,listId,symbol,side:'BUY',
     strategy:current.strategy.id,rule:decision.rule,reason:decision.reason,
     quote:currentQuote,time:new Date().toISOString(),closedAt:market.closedAt,
     experimental:true,verification:'native-demo-opoco'};
   current.lastDispatchedCandle??={};
   current.lastDispatchedCandle[symbol]=market.closedAt;
   return {accepted:true,clientId,listId};
 });
 if(!reservation.accepted)return reservation;
 const order={symbol,listClientOrderId:listId,workingClientOrderId:clientId,
   workingPrice:quote.quoteLimit,workingQuantity:quote.amount,
   belowStopPrice:quote.stopPrice,abovePrice:quote.targetPrice};
 try {
   const acknowledgment=await placeDemoOpoco(order);
   if(!acknowledgment || acknowledgment.symbol!==symbol||acknowledgment.listClientOrderId!==listId||
     !Number.isSafeInteger(acknowledgment.orderListId)||acknowledgment.orderListId<0)
     throw Error('Demo OPOCO response identity mismatch');
   await changeState(current=>{
     if(current.pending?.listId!==listId)return {unchanged:true};
     current.pending.orderListId=acknowledgment.orderListId;
     current.pending.acknowledgedAt=new Date().toISOString();
   });
 } catch (error) {
   // A network error after exchange acceptance is ambiguous. Never retry this POST.
   // Reconcile the known list client ID in a later cycle.
   return {...quote,clientId,listId,reconciliation:'required',error:'Demo OPOCO acknowledgment not confirmed'};
 }
 return {...quote,clientId,listId,reconciliation:'pending'};
}

export async function resolveProtectedDemo(pending) {
 if(pending.kind!=='opoco')throw Error('Unsupported pending kind');
 const list=await demoOrderList(pending.listId);
 if(list.listClientOrderId!==pending.listId||list.symbol!==pending.symbol ||
   !Number.isSafeInteger(list.orderListId))throw Error('Unexpected Demo order list');
 const rows=Array.isArray(list.orders)?list.orders:[];
 if(rows.length!==3)throw Error('Incomplete Demo OPOCO order list');
 if(list.listOrderStatus!=='ALL_DONE')return null;
 const orders=await Promise.all(rows.map(row=>demo('/api/v3/order',{symbol:pending.symbol,orderId:row.orderId},true)));
 const buys=orders.filter(x=>x.side==='BUY');
 const sold=orders.filter(x=>x.side==='SELL'&&x.status==='FILLED');
 if(buys.length!==1||sold.length>1)throw Error('Unexpected Demo OPOCO settlement');
 const buy=buys[0],sell=sold[0];
 if(!['FILLED','EXPIRED','CANCELED'].includes(buy.status))throw Error('Unsettled Demo entry');
 if(buy.status==='FILLED'&&!sell)throw Error('Demo entry filled but no protected exit settled; manual review required');
 const trades=await Promise.all(orders.filter(x=>x.status==='FILLED').map(async o=>{
   const fills=await demo('/api/v3/myTrades',{symbol:pending.symbol,orderId:o.orderId,limit:1000},true);
   return {order:o,fills};
 }));
 let feeUsd=0;
 for(const {order,fills} of trades){
   let filled=0;
   for(const f of fills){
     if(f.orderId!==order.orderId||f.symbol!==pending.symbol)throw Error('Unexpected trade fill');
     filled+=Number(f.qty);
     const fee=Number(f.commission);
     if(!Number.isFinite(fee)||fee<0)throw Error('Invalid fee');
     if(f.commissionAsset==='USDT')feeUsd+=fee;
     else if(f.commissionAsset===pending.symbol.slice(0,-4))feeUsd+=fee*Number(f.price);
     else if(fee>0)throw Error('Unsupported fee token; requires valuation');
   }
   if(Math.abs(filled-Number(order.executedQty))>1e-8)throw Error('Incomplete exchange fills');
 }
 const cost=buy.status==='FILLED'?Number(buy.cummulativeQuoteQty):0;
 const revenue=sell?Number(sell.cummulativeQuoteQty):0;
 if(!Number.isFinite(cost)||!Number.isFinite(revenue)||cost<0||revenue<0)throw Error('Invalid Demo settlement amounts');
 return {kind:'protectedRoundTrip',status:sell?'CLOSED':buy.status,
   symbol:pending.symbol,side:'BUY',time:new Date(Math.max(...orders.map(x=>Number(x.updateTime)||0))).toISOString(),
   strategy:pending.strategy,rule:pending.rule,reason:pending.reason,quote:cost,
   netProfit:sell?revenue-cost-feeUsd:0,feeUsd,orderListId:list.orderListId,
   quantity:Number(buy.executedQty),entryPrice:Number(buy.price),
   exitPrice:sell?Number(sell.cummulativeQuoteQty)/Number(sell.executedQty):null,
   experimental:true,risk:pending.quote};
}

export function applyProtectedFill(state,fill) {
 if(fill.kind!=='protectedRoundTrip'||state.pending?.kind!=='opoco')throw Error('Invalid protected settlement');
 const {day,month}=periods(Date.parse(fill.time));
 const daily=state.days[day]??={volume:0,trades:0,loss:0,orders:0};
 if(fill.quantity>0)daily.trades++;
 daily.volume+=fill.quote;
 if(fill.status==='CLOSED'){
   state.realized+=fill.netProfit;
   daily.loss+=Math.max(0,-fill.netProfit);
   const m=state.months[month]??={loss:0};m.loss+=Math.max(0,-fill.netProfit);
   const stats=state.performance??={closed:0,wins:0,losses:0,fees:0};
   stats.closed++;stats.wins+=Number(fill.netProfit>0);stats.losses+=Number(fill.netProfit<0);stats.fees+=fill.feeUsd;
 }
 state.pending=null;
 return fill;
}

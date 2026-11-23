import { createHash } from 'node:crypto';
import { demo, account, rules, deploymentCanTrade, demoOrderList, placeDemoOpoco, bookTicker, bookQuote,
  validateDemoWorkingOrder, DemoError } from './demo.js';
import { maxTrialUsd, trialBlock } from './manager.js';
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

export function protectedQuote({settings,state,market,wallet,filters,ticker,now=Date.now(),fullPrincipal=false,trial=false,validationOnly=false}) {
 if(!settings || !state || !market || !wallet || !filters || !ticker) return invalid('inputs','Missing verified Demo market input');
 if((state.stopped && !validationOnly) || state.pending || (!protectedDemoEnabled() && !validationOnly))return invalid('disabled','Demo protection or execution disabled');
 if(!filters.opocoAllowed) return invalid('unsupported','Binance Demo symbol does not support native OPOCO protection');
 if(wallet.canTrade!==true) return invalid('account','Demo account cannot trade Spot');
 const {day,month}=periods(now);
 const daily=state.days?.[day]??{orders:0,trades:0,volume:0,loss:0};
 const monthLoss=state.months?.[month]?.loss??0;
 const openPositions=Object.values(state.positions??{});
 // Legacy open positions have not been reconciled against native exchange protection.
 if(openPositions.length)return invalid('exposure','Unreconciled or older positions require protection review');
 if((daily.experimental??0)>=1)return invalid('training-cap','Only one exploratory Demo entry is permitted per day');
 if((daily.orders??daily.trades??0)+2>Math.min(settings.maxTrades,3))return invalid('daily-cap','Demo daily order cap reached');
 const ask=Number(ticker.askPrice),bid=Number(ticker.bidPrice);
 if(!Number.isFinite(ask)||!Number.isFinite(bid)||ask<=0||bid<=0||bid>ask ||
    (ask-bid)/ask>.003)return invalid('spread','Demo bid/ask is unavailable or spread exceeds 0.3%');
 if(Math.abs(ask/market.price-1)>.015)return invalid('market-deviation','Demo quote moved more than 1.5% from latest closed candle');
 const price=ceilTo(ask*1.001,filters.tickSize);
 if(!Number.isFinite(price)||price<=0)return invalid('price','Demo price filter unavailable');
 const riskUsd=inUsd(settings,'riskPerTrade');
 const rate=Number(wallet.commissionRates?.taker)+Number(wallet.commissionRates?.buyer);
 if(fullPrincipal && (!Number.isFinite(rate)||rate<0||rate>.01))return invalid('fees','Verified Demo entry fee exceeds the risk buffer');
 const fullRisk=fullPrincipal?Math.min(riskUsd, settings.capital*.03, trial?maxTrialUsd:Infinity,
   inUsd(settings,'dailyLoss')-(daily.loss??0),inUsd(settings,'monthlyLoss')-monthLoss):Infinity;
 const budget=Math.min(settings.capital+Math.min(0,state.realized??0), inUsd(settings,'maxPosition'),
   inUsd(settings,'dailyVolume')-(daily.volume??0), Number(wallet.balances?.find(b=>b.asset==='USDT')?.free??0),fullRisk);
 const quantity=floorTo(budget/price/(fullPrincipal?1.01:1.003),filters.step);
 const notional=quantity*price;
 if(!Number.isFinite(quantity)||quantity<filters.minQty||quantity>filters.maxQty ||
    notional<filters.minimum*(trial?1.20:1.005))return invalid('minimum','Safe order budget is below the verified Binance Demo minimum');
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
 const trial=decision.mode==='demo-trial';
 const sizing={market,wallet,filters,ticker,trial,fullPrincipal:decision.fullPrincipal===true};
 const quote=protectedQuote({settings:state.settings,state,...sizing});
 if(!quote.accepted)return quote;
 const clientId='ta-'+createHash('sha256').update(leaseId+':opoco:'+symbol).digest('hex').slice(0,28);
 const listId='tl-'+createHash('sha256').update(leaseId+':list:'+symbol).digest('hex').slice(0,28);
 if (trial) {
   try { await validateDemoWorkingOrder({symbol,clientId,price:quote.quoteLimit,quantity:quote.amount}); }
   catch (error) { return invalid('trial-preflight', error?.code ? 'Signed Demo working order rejected ('+error.code+')' : 'Signed Demo working-order check unavailable'); }
 }
 const reservation=await changeState(current=>{
   if(current.lease?.id!==leaseId||current.lease.until<=Date.now()||current.stopped||current.pending||
     !currentVerification(current,fingerprint)||!protectedDemoEnabled())
     return {unchanged:true,value:invalid('lease','Demo safety lease not valid')};
   const blocked=trial?trialBlock(current,symbol,decision):null;
   if(blocked)return {unchanged:true,value:invalid('trial-policy',blocked)};
   if(current.lastDispatchedCandle?.[symbol]===market.closedAt)return {unchanged:true,value:invalid('same-candle','Entry already sent for this candle')};
   const currentQuote=protectedQuote({settings:current.settings,state:current,...sizing});
   if(!currentQuote.accepted)return {unchanged:true,value:currentQuote};
   const {day}=periods();
   const daily=current.days[day]??={volume:0,trades:0,loss:0,orders:0};
   daily.orders=(daily.orders??daily.trades??0)+1;
   daily.experimental=(daily.experimental??0)+1;
   current.pending={kind:'opoco',status:'dispatching',clientId,listId,symbol,side:'BUY',
     strategy:current.strategy.id,rule:decision.rule,reason:decision.reason,
     quote:currentQuote,time:new Date().toISOString(),closedAt:market.closedAt,
     mode:decision.mode,manager:decision.manager,experimental:true,verification:'native-demo-opoco'};
   if(trial)current.trial={...current.trial,day,opens:current.trial?.day===day?current.trial.opens+1:1};
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
   // Only explicit Binance validation rejections can be marked rejected.
   // A transport failure is ambiguous and must be reconciled, never retransmitted.
   if(error instanceof DemoError && [-1013,-1021,-1022,-1100,-1102,-1111,-1116,-2010,-2015].includes(error.code)){
     await changeState(current=>{
       if(current.pending?.listId!==listId)return {unchanged:true};
       current.pending.rejectionCode=error.code;
       current.pending.status='rejected';
       current.pending.rejectedAt=new Date().toISOString();
     });
     return {accepted:false,code:'demo-rejected',reason:'Binance Demo rejected the protected order',clientId,listId};
   }
   // A network error after exchange acceptance is ambiguous. Never retry this POST.
   // Reconcile the known list client ID in a later cycle.
   return {...quote,clientId,listId,reconciliation:'required',error:'Demo OPOCO acknowledgment not confirmed'};
 }
 return {...quote,clientId,listId,reconciliation:'pending'};
}

export async function resolveProtectedDemo(pending) {
 if(pending.kind!=='opoco')throw Error('Unsupported pending kind');
 if(pending.status==='rejected' && Number.isInteger(pending.rejectionCode)){
   return {kind:'protectedRoundTrip',status:'REJECTED',symbol:pending.symbol,side:'BUY',
     time:pending.rejectedAt??new Date().toISOString(),strategy:pending.strategy,rule:pending.rule,
     reason:'Binance Demo rejected the OPOCO order',quote:0,netProfit:0,feeUsd:0,
     quantity:0,entryPrice:null,exitPrice:null,experimental:true,risk:pending.quote,
     rejectionCode:pending.rejectionCode};
 }
 let list;
 try{list=await demoOrderList(pending.listId);}
 catch(error){
   if(error instanceof DemoError && error.code===-2013 &&
     Date.now()-Date.parse(pending.time)>180000){
     const n=await changeState(current=>{
       if(current.pending?.listId!==pending.listId)return {unchanged:true,value:0};
       if(Date.now()-Date.parse(current.pending.lastNotFoundAt??0)<120000)
         return {unchanged:true,value:current.pending.notFoundChecks??0};
       current.pending.notFoundChecks=(current.pending.notFoundChecks??0)+1;
       current.pending.lastNotFoundAt=new Date().toISOString();
       return current.pending.notFoundChecks;
     });
     if(n>=2)return {kind:'protectedRoundTrip',status:'NOT_ACCEPTED',
       symbol:pending.symbol,side:'BUY',time:new Date().toISOString(),
       strategy:pending.strategy,rule:pending.rule,reason:'Demo order absent in multiple signed queries',
       quote:0,netProfit:0,feeUsd:0,quantity:0,entryPrice:null,exitPrice:null,
       experimental:true,risk:pending.quote};
   }
   throw error;
 }
 if(list.listClientOrderId!==pending.listId||list.symbol!==pending.symbol ||
   !Number.isSafeInteger(list.orderListId))throw Error('Unexpected Demo order list');
 const rows=Array.isArray(list.orders)?list.orders:[];
 if(!rows.length||rows.length>3)throw Error('Unexpected Demo OPOCO order list');
 if(list.listOrderStatus!=='ALL_DONE'){
   if(pending.entryObserved)return null;
   const entry=await demo('/api/v3/order',{symbol:pending.symbol,origClientOrderId:pending.clientId},true);
   if(entry.status!=='FILLED'||entry.side!=='BUY'||entry.clientOrderId!==pending.clientId||entry.symbol!==pending.symbol)return null;
   const quantity=Number(entry.executedQty),quote=Number(entry.cummulativeQuoteQty);
   if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(quote)||quote<=0)throw Error('Invalid protected entry fill');
   return {kind:'protectedOpen',status:'ENTRY_FILLED',symbol:pending.symbol,side:'BUY',time:new Date(entry.updateTime).toISOString(),
     strategy:pending.strategy,rule:pending.rule,reason:pending.reason,quantity,quote,price:quote/quantity,mode:pending.mode,
     clientId:pending.clientId,orderId:entry.orderId,orderListId:list.orderListId,risk:pending.quote,manager:pending.manager};
 }
 const orders=await Promise.all(rows.map(row=>demo('/api/v3/order',{symbol:pending.symbol,orderId:row.orderId},true)));
 const buys=orders.filter(x=>x.side==='BUY');
 const sold=orders.filter(x=>x.side==='SELL'&&x.status==='FILLED');
 if(buys.length!==1||sold.length>1)throw Error('Unexpected Demo OPOCO settlement');
 const buy=buys[0],sell=sold[0];
 if(!['FILLED','EXPIRED','CANCELED','REJECTED'].includes(buy.status))throw Error('Unsettled Demo entry');
 if(buy.status==='FILLED'&&!sell)throw Error('Demo entry filled but no protected exit settled; manual review required');
 const trades=await Promise.all(orders.filter(x=>x.status==='FILLED').map(async o=>{
   const fills=await demo('/api/v3/myTrades',{symbol:pending.symbol,orderId:o.orderId,limit:1000},true);
   return {order:o,fills};
 }));
 let feeUsd=0;
 const bnbMark=pending.symbol!=='BNBUSDT' && trades.some(({fills})=>fills.some(f=>f.commissionAsset==='BNB'&&Number(f.commission)>0))?
   (await bookQuote('BNBUSDT')).ask:null;
 for(const {order,fills} of trades){
   let filled=0;
   for(const f of fills){
     if(f.orderId!==order.orderId||f.symbol!==pending.symbol)throw Error('Unexpected trade fill');
     filled+=Number(f.qty);
     const fee=Number(f.commission);
     if(!Number.isFinite(fee)||fee<0)throw Error('Invalid fee');
     if(f.commissionAsset==='USDT')feeUsd+=fee;
     else if(f.commissionAsset===pending.symbol.slice(0,-4))feeUsd+=fee*Number(f.price);
     else if(f.commissionAsset==='BNB'&&bnbMark)feeUsd+=fee*bnbMark;
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
   netProfit:sell?revenue-cost-feeUsd:0,feeUsd,orderListId:list.orderListId, exitQuote:revenue,
   entryAt: new Date(Number(buy.updateTime) || Date.parse(pending.time)).toISOString(),
   quantity:Number(buy.executedQty),entryPrice:Number(buy.executedQty)>0?cost/Number(buy.executedQty):null,
   entryMode:pending.mode,entryRule:pending.rule,entryCandle:pending.closedAt,bnbFeeMark:bnbMark,
   exitPrice:sell?Number(sell.cummulativeQuoteQty)/Number(sell.executedQty):null,
   experimental:true,risk:pending.quote};
}

export function applyProtectedFill(state,fill) {
 if(!['protectedOpen','protectedRoundTrip'].includes(fill.kind)||state.pending?.kind!=='opoco')throw Error('Invalid protected settlement');
 if(fill.kind==='protectedOpen'){
   if(state.pending.entryObserved)return fill;
   state.pending.entryObserved=true;
   const {day}=periods(Date.parse(fill.time));
   const daily=state.days[day]??={volume:0,trades:0,loss:0,orders:0};
   daily.trades++;
   daily.volume+=fill.quote;
   if(fill.mode==='demo-trial')state.trial={...state.trial,verifiedFill:fill.clientId};
   return fill;
 }
 const {day,month}=periods(Date.parse(fill.time));
 const daily=state.days[day]??={volume:0,trades:0,loss:0,orders:0};
 if(fill.quantity>0&&!state.pending.entryObserved){
   const entryDay=periods(Date.parse(fill.entryAt??fill.time)).day;
   const entry=state.days[entryDay]??={volume:0,trades:0,loss:0,orders:0};
   entry.trades++;
   entry.volume+=fill.quote;
 }
 if(fill.quantity>0&&state.pending.mode==='demo-trial')state.trial={...state.trial,verifiedFill:state.pending.clientId};
 if(fill.status==='CLOSED'){
   daily.orders=(daily.orders??daily.trades)+1;
   daily.volume+=fill.exitQuote??0;
   state.realized+=fill.netProfit;
   daily.loss+=Math.max(0,-fill.netProfit);
   const m=state.months[month]??={loss:0};m.loss+=Math.max(0,-fill.netProfit);
   const stats=state.performance??={closed:0,wins:0,losses:0,fees:0};
   stats.closed++;stats.wins+=Number(fill.netProfit>0);stats.losses+=Number(fill.netProfit<0);stats.fees+=fill.feeUsd;
 }
 state.pending=null;
 return fill;
}

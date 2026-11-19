export const names=['Market Analyst','News Analyst','Strategy Agent','Risk Manager','Learning Agent'];
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
export function analyze(candles,settings,history=[]){
 if(!Array.isArray(candles)||candles.length<30)throw Error('Insufficient market data');
 const closes=candles.map(c=>Number(c[4]));
 if(closes.some(n=>!Number.isFinite(n)||n<=0))throw Error('Invalid prices');
 const price=closes.at(-1),fast=mean(closes.slice(-10)),slow=mean(closes.slice(-30));
 const diffs=closes.slice(-15).slice(1).map((p,i)=>p-closes.slice(-15)[i]);
 const gain=mean(diffs.map(x=>Math.max(0,x))),loss=mean(diffs.map(x=>Math.max(0,-x)));
 const rsi=loss===0?(gain===0?50:100):100-100/(1+gain/loss);
 const direction=fast>slow?'UP':fast<slow?'DOWN':'FLAT';
 const volume=Number(candles.at(-1)[5]||0);
 const capital=Number(settings.capital),limit=Number(settings.dailyVolume?.value);
 const daily=settings.dailyVolume?.mode==='percent'?capital*limit/100:limit;
 const stats=history.filter(t=>Number.isFinite(t.netProfit));
 return [{agent:names[0],status:'complete',details:{price,fast,slow,rsi,direction,volume}},
 {agent:names[1],status:'unavailable',details:'No verified news feed; no news assessment fabricated'},
 {agent:names[2],status:'research-only',details:{strategy:'SMA 10/30 + RSI 14',direction,reason:'Closed candle trend and momentum assessment; no executable recommendation'}},
 {agent:names[3],status:'blocked',details:{reason:'Demo order execution not activated',capital,dailyBudget:Number.isFinite(daily)?daily:null,maxPosition:settings.maxPosition,riskPerTrade:settings.riskPerTrade}},
 {agent:names[4],status:stats.length?'complete':'waiting',details:{closedTrades:stats.length,netProfit:stats.reduce((s,t)=>s+t.netProfit,0),wins:stats.filter(t=>t.netProfit>0).length,reason:'Historical results only; no autonomous strategy changes'}}];
}

export const names=['Market Analyst','News Analyst','Strategy Agent','Risk Manager','Learning Agent'];
export function analyze(candles,settings){
 if(!Array.isArray(candles)||candles.length<30) throw Error('Insufficient market data');
 const closes=candles.map(c=>Number(c[4]));
 if(closes.some(n=>!Number.isFinite(n)||n<=0)) throw Error('Invalid market data');
 const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
 const price=closes.at(-1),fast=mean(closes.slice(-10)),slow=mean(closes.slice(-30));
 const direction=fast>slow?'UP':fast<slow?'DOWN':'FLAT';
 return [{agent:names[0],status:'complete',details:{price,fast,slow,direction}},
 {agent:names[1],status:'unavailable',details:'No verified news source configured'},
 {agent:names[2],status:'research-only',details:{strategy:'SMA trend research',direction,reason:'Comparison of 10 and 30 closed candle means; not an execution signal'}},
 {agent:names[3],status:'blocked',details:{reason:'Order execution is disabled in this foundation build',capital:settings.capital}},
 {agent:names[4],status:'waiting',details:'No completed simulated trades to evaluate'}];
}

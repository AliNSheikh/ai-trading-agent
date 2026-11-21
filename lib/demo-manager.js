export function demoManagerCommand({candidates=[],markets={},news=null,strategyReady=false,benchmarkPassed=false,stopped=false,hasPending=false}) {
 const base={at:new Date().toISOString(),authority:'research manager only; risk engine is final',mode:'Demo exploratory'};
 if(stopped||hasPending)return {...base,side:'HOLD',reason:'Emergency stop or unresolved exchange order prevents new entries'};
 if(!strategyReady||!benchmarkPassed||!['positive','neutral'].includes(news))
   return {...base,side:'HOLD',reason:'Current strategy, verified model benchmark or news review unavailable'};
 const options=[];
 for(const c of candidates){
   if(c.side!=='BUY'||!['trend','breakout','pullback','reversion'].includes(c.rule))continue;
   const m=markets[c.symbol];
   if(!m||m.direction!=='UP'||!Number.isFinite(m.rsi)||m.rsi<45||m.rsi>75||
      !Number.isFinite(m.relativeVolume)||m.relativeVolume<1.1||
      !Number.isFinite(m.volatilityPercent)||m.volatilityPercent<0||m.volatilityPercent>1.5)continue;
   const score=Number((Math.min(3,m.relativeVolume)*2+
      (c.rule==='breakout'?1:c.rule==='pullback'?.6:c.rule==='trend'?.5:.2) -
      m.volatilityPercent).toFixed(3));
   options.push({symbol:c.symbol,rule:c.rule,score,reason:c.reason});
 }
 options.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
 const selected=options[0];
 return selected?{...base,side:'BUY',symbol:selected.symbol,rule:selected.rule,
    score:selected.score,reason:'Highest-ranked qualified Demo training candidate: '+selected.reason,
    alternatives:options.slice(1,4)}
   :{...base,side:'HOLD',reason:'No candidate passed the Demo market, volatility and momentum checks'};
}

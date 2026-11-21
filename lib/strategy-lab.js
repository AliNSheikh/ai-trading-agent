import { marketAnalyst } from './agents.js';
import { entryCandidates, entryRules } from './playbook.js';

export const labVersion = 'walk-forward-multi-v1';
const feePerSide = 0.002;
const horizon = 4;
const notional = 10;
const strategies = [...Object.keys(entryRules), 'momentum', 'volatility'];
const mean = values => values.length ? values.reduce((s,x)=>s+x,0)/values.length : null;
const round = value => Number(value.toFixed(8));

export function candidateRules(rows, strategy) {
  if (!Array.isArray(rows) || rows.length < 42) return [];
  const market = marketAnalyst(rows, strategy);
  const found=entryCandidates(rows, market, strategy);
  const last=Number(rows.at(-1)[4]), prior=Number(rows.at(-5)[4]);
  if(market.direction==='UP' && market.rsi>=52 && market.rsi<=70 && market.relativeVolume>=1.15 &&
    last>prior && market.volatilityPercent<1.8)
    found.push({rule:'momentum',reason:'Four-candle positive momentum, controlled volatility and volume confirmation'});
  if(market.direction==='UP' && market.volatilityPercent>=0.25 && market.volatilityPercent<=1.2 &&
    market.relativeVolume>=1.3 && market.rsi>=47 && market.rsi<=67)
    found.push({rule:'volatility',reason:'Contained breakout volatility with confirmed volume'});
  return found;
}

// The signal at close T is executed at the NEXT candle open. Its result is measured
// at a later open. No future candle participates in its signal or model selection.
export function tradeExamples(rows, strategy) {
  if (!Array.isArray(rows) || rows.length < 150) return [];
  const trades = [];
  for (let i=41; i+horizon+1<rows.length; i+=horizon+1) {
    const sample = rows.slice(i-41,i+1);
    const signals = candidateRules(sample,strategy);
    if (!signals.length) continue;
    const entry = Number(rows[i+1][1]);
    const exit = Number(rows[i+horizon+1][1]);
    if (![entry,exit].every(x=>Number.isFinite(x)&&x>0)) continue;
    const netUsd = notional * (exit/entry*(1-feePerSide)-(1+feePerSide));
    for(const rule of new Set(signals.map(x=>x.rule))) {
      trades.push({rule,at:rows[i][6],exitAt:rows[i+horizon+1][0],netUsd:round(netUsd)});
    }
  }
  return trades;
}

function summarize(items) {
  const wins=items.filter(x=>x.netUsd>0).length;
  let equity=0, peak=0, maxDrawdown=0;
  for(const x of items){ equity+=x.netUsd;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity); }
  return {trades:items.length,wins,winRate:items.length?round(wins/items.length):null,
    netUsd:round(equity),meanUsd:items.length?round(equity/items.length):null,
    maxDrawdownUsd:round(maxDrawdown)};
}
export function walkForward(rows,strategy) {
  if(!Array.isArray(rows)||rows.length<750)return {status:'insufficient-data',count:rows?.length??0,version:labVersion};
  const trainEnd=Math.floor(rows.length*.60);
  const validationEnd=Math.floor(rows.length*.80);
  // Purge an entire holding horizon between evaluation periods.
  const train=tradeExamples(rows.slice(0,trainEnd-horizon),strategy);
  const validation=tradeExamples(rows.slice(trainEnd,validationEnd-horizon),strategy);
  const test=tradeExamples(rows.slice(validationEnd),strategy);
  const byRule=(examples,rule)=>summarize(examples.filter(x=>x.rule===rule));
  const training=strategies.map(rule=>({rule,...byRule(train,rule)}));
  const trained=training.filter(x=>x.trades>=12&&x.netUsd>0).sort((a,b)=>b.meanUsd-a.meanUsd);
  const selected=trained.filter(x=>{const v=byRule(validation,x.rule);return v.trades>=5&&v.netUsd>0})
    .sort((a,b)=>byRule(validation,b.rule).meanUsd-byRule(validation,a.rule).meanUsd)[0];
  const holdout=selected?byRule(test,selected.rule):null;
  const eligible=Boolean(selected && holdout && holdout.trades>=8 && holdout.netUsd>0 && holdout.winRate>0.5);
  return {status:eligible?'research-qualified':'insufficient-evidence',version:labVersion,
    selectedRule:selected?.rule??null,
    training,validation:Object.fromEntries(strategies.map(rule=>[rule,byRule(validation,rule)])),
    holdout:holdout?{...holdout,from:new Date(rows[validationEnd][0]).toISOString()}:null,
    eligibleForExecution:false, // A separate approved forecast and protected execution are mandatory.
    reason:eligible?'Positive independently tested research candidate; NOT execution approval':
      'No candidate passed the independent training, validation, and untouched holdout requirements'};
}

export function managerDirective({markets={},reports={},existingPositions={},sentiment='neutral'}) {
  const ranked=[];
  for(const [symbol,market] of Object.entries(markets)){
    const plan=reports[symbol];
    const rule=plan?.selectedRule;
    const eligible=plan?.status==='research-qualified';
    const holding=Boolean(existingPositions[symbol]);
    const side=holding && (market.direction==='DOWN'||market.rsi>75)?'SELL':
      eligible && !holding && sentiment!=='negative'?'WATCH':'HOLD';
    ranked.push({symbol,side,rule:rule??null,eligible,reason:side==='SELL'?'Protective exit review for held position':
      eligible?'Validated candidate; exchange execution requires a separately approved risk and model gate':
      'No independently validated opportunity'});
  }
  ranked.sort((a,b)=>Number(b.side==='SELL')-Number(a.side==='SELL')||Number(b.eligible)-Number(a.eligible)||a.symbol.localeCompare(b.symbol));
  return {status:'research-directive',at:new Date().toISOString(),priority:ranked[0]??null,ranked,
    noOverride:'Manager cannot bypass risk, forecast approval, or protective-order verification'};
}

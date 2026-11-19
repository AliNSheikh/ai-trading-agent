import {protect} from '../lib/security.js';
import {readData} from '../lib/store.js';
import {analyze} from '../lib/agents.js';
import {demo} from '../lib/demo.js';
export async function reports(settings,journal){
 const symbols=settings.pairs.filter(s=>['BTCUSDT','ETHUSDT','SOLUSDT'].includes(s));
 return Promise.all(symbols.map(async symbol=>{
 const rows=(await demo('/api/v3/klines',{symbol,interval:'15m',limit:32})).filter(c=>Number(c[6])<Date.now());
 return {symbol,time:new Date().toISOString(),agents:analyze(rows,settings,journal.trades??[])};
 }));
}
export default async function handler(req,res){
 if(!protect(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 try{const [settings,journal]=await Promise.all([readData('config/defaults.json'),readData('journal/events.json')]);
 res.status(200).json({mode:'demo-research',execution:false,reports:await reports(settings,journal)});
 }catch{res.status(503).json({error:'Demo research unavailable; no order placed'});}
}

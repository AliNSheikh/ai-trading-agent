import {protect} from '../lib/security.js';
import {readData} from '../lib/store.js';
import {analyze} from '../lib/agents.js';
export default async function handler(req,res){
 if(!protect(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 try{
 const settings=await readData('config/defaults.json');
 const reports=[];
 for(const symbol of settings.pairs.filter(s=>['BTCUSDT','ETHUSDT','SOLUSDT'].includes(s))){
 const u=new URL('https://testnet.binance.vision/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval','15m');u.searchParams.set('limit','32');
 const r=await fetch(u,{signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error('Market unavailable');
 const rows=(await r.json()).filter(c=>Number(c[6])<Date.now());
 reports.push({symbol,time:new Date().toISOString(),agents:analyze(rows,settings)});
 }
 res.status(200).json({mode:'research-only',execution:false,reports});
 }catch{res.status(503).json({error:'Research unavailable; no order placed'});}
}

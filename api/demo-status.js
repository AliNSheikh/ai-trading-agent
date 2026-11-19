import {protect} from '../lib/security.js';
import {demo} from '../lib/demo.js';
export default async function handler(req,res){
 if(!protect(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 try{await demo('/api/v3/ping');if(!process.env.BINANCE_DEMO_API_KEY||!process.env.BINANCE_DEMO_API_SECRET)return res.json({mode:'demo',marketConnected:true,accountConnected:false,execution:false});
 const a=await demo('/api/v3/account',{},true);
 return res.json({mode:'demo',marketConnected:true,accountConnected:true,accountType:a.accountType,execution:false});
 }catch{return res.status(503).json({mode:'demo',connected:false,execution:false,error:'Demo connectivity or credentials unavailable'});}
}

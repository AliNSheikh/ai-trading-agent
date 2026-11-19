import {scryptSync,timingSafeEqual} from 'node:crypto';
export function authorized(header,hash=process.env.ADMIN_PASSWORD_HASH){
 if(!hash||!/^([0-9a-f]{32}):([0-9a-f]{64})$/.test(hash)||!header?.startsWith('Basic '))return false;
 try{
 const [salt,digest]=hash.split(':');
 const auth=Buffer.from(header.slice(6),'base64').toString('utf8');
 if(!auth.startsWith('admin:')||auth.length>1024)return false;
 return timingSafeEqual(scryptSync(auth.slice(6),salt,32),Buffer.from(digest,'hex'));
 }catch{return false;}
}
export function protect(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
 if(!process.env.ADMIN_PASSWORD_HASH){res.status(503).end('Administrator setup required');return false;}
 if(!authorized(req.headers.authorization)){res.setHeader('WWW-Authenticate','Basic realm="Private Trading Research"');res.status(401).end('Authentication required');return false;}
 return true;
}

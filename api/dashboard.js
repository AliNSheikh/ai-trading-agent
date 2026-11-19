import {protect} from '../lib/security.js';
import {readData} from '../lib/store.js';
import {names} from '../lib/agents.js';
export default async function handler(req,res){
 if(!protect(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 let settings=null,journal=null;
 try{settings=await readData('config/defaults.json');journal=await readData('journal/events.json');}catch{}
 const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.status(200).end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Trading Agent</title><style>body{background:#0c1424;color:#eff6ff;font:16px system-ui;margin:0}main{max-width:1100px;margin:auto;padding:32px}section{background:#172338;border:1px solid #314159;border-radius:16px;padding:20px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.grid section{margin:0}small{color:#a8b9ce}strong{color:#63e6be}a{color:#93c5fd}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h1>AI Trading Agent V1.0</h1><p><strong>وضع البحث التجريبي فقط — التداول معطل</strong></p><div class="grid"><section><small>رأس المال المخصص</small><h2>$'+e(settings?.capital??100)+'</h2></section><section><small>حجم التداول اليومي</small><h2>'+e(settings?.dailyVolume?.value??20)+' '+e(settings?.dailyVolume?.mode??"percent")+'</h2></section><section><small>حالة البيانات</small><h2>'+(settings&&journal?'متصلة':'تحتاج إعداداً')+'</h2></section></div><h2>الوكلاء الخمسة</h2><div class="grid">'+names.map(n=>'<section><h3>'+e(n)+'</h3><small>بحث تجريبي — لا توجد صلاحية تنفيذ</small></section>').join('')+'</div><section><h2>سجل النشاط والقرارات</h2><pre>'+e(JSON.stringify(journal??{status:'not connected'},null,2))+'</pre></section><section><h2>إعدادات المخاطر</h2><pre>'+e(JSON.stringify(settings??{},null,2))+'</pre></section><section><h2>سجل الصفقات</h2><p>لا توجد صفقات منفذة. محرك الأوامر غير مفعّل.</p><a href="/api/research">عرض تحليل السوق التجريبي (JSON)</a></section></main></html>');
}

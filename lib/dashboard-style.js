export const css = String.raw`
:root{color-scheme:light;--bg:#f2f6f4;--panel:#fff;--line:#dbe7e2;--muted:#536c66;--ink:#172f2b;--accent:#157469;--accent-dark:#0d584f;--mint:#e4f4ee;--warn:#744e0b;--red:#a23943;font:15px/1.5 system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink)}
main{width:min(1510px,100%);margin:auto;padding:0 clamp(16px,4vw,56px) 60px}
h1,h2,h3,p{margin:0}
h1{font-size:clamp(29px,4vw,45px);letter-spacing:-.053em;line-height:1.05}
h2{font-size:19px;letter-spacing:-.028em;margin-bottom:3px}
h3{font-size:15px;letter-spacing:-.015em;margin-bottom:6px}
p,small,label,th{color:var(--muted)}
a{color:var(--accent-dark)}
button,select,input{font:inherit;color:var(--ink);border:1px solid #cbded6;border-radius:9px;background:#fff;padding:8px 12px;max-width:100%}
button{cursor:pointer;font-weight:650;font-size:13px;min-height:38px;text-align:center}
button:hover{border-color:var(--accent);background:#f4fbf8}
button:disabled{opacity:.5;cursor:default}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
button.primary:hover{background:var(--accent-dark)}
button.danger{color:#8c3540;background:#fff7f5;border-color:#edd5d4}
button[aria-pressed=true]{background:var(--mint);border-color:#83b6a8;color:var(--accent-dark)}
:focus-visible{outline:2px solid #168a7c;outline-offset:3px}
.row,.row-spread{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.row-spread{justify-content:space-between;gap:13px}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:18px 0;border-bottom:1px solid var(--line)}
.identity{display:flex;align-items:center;gap:10px;font-weight:750;letter-spacing:-.03em}
.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:#166b61;color:#fff;font-size:18px}
.topbar .identity small{display:block;font-size:11px;letter-spacing:.04em;font-weight:600}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:16px 30px;flex-wrap:wrap;margin:29px 0 20px}
.hero p{max-width:57ch;margin-top:7px}
.hero .badge{margin-bottom:3px}
nav{display:flex;gap:4px;overflow:auto;border-bottom:1px solid var(--line);scrollbar-width:thin}
nav a{display:block;white-space:nowrap;text-decoration:none;padding:11px 14px 13px;color:var(--muted);font-size:14px;font-weight:650;border-bottom:2px solid transparent}
nav a[aria-current=page]{border-color:var(--accent);color:var(--accent-dark)}
nav a:hover{background:#e9f3ee}
.panel{padding:clamp(15px,2vw,22px);background:var(--panel);border:1px solid var(--line);border-radius:14px;min-width:0;box-shadow:0 2px 6px #16372e06}
.panel>.row-spread:first-child{margin-bottom:12px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))}
.metric-card{background:#fbfefd}
.metric-card:first-child{background:#e6f5ed;border-color:#cbe6d8}
.metric{font-size:clamp(20px,2.5vw,31px);font-weight:730;letter-spacing:-.045em;color:var(--ink);font-variant-numeric:tabular-nums;margin-top:3px}
.block{margin-top:16px}
.cards{margin-bottom:14px}
.split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px}
.overview-layout{display:grid;grid-template-columns:minmax(0,2.35fr) minmax(244px,1fr);gap:14px;align-items:start}
.panel-stack{display:grid;gap:14px}
.badge{display:inline-flex;align-items:center;gap:6px;background:#e7f6ef;border:1px solid #c8e7d5;color:#255f4b;padding:4px 9px;border-radius:99px;font-size:12px;font-weight:650}
.badge.warning{color:var(--warn);background:#fcf6e8;border-color:#eee0bf}
.error,.negative{color:var(--red)}
.positive{color:#11694f}
#notice{min-height:22px;margin:9px 0;color:var(--warn);font-size:13px}
.empty{padding:13px 0}
.table-wrap{overflow:auto;min-width:0}
table{width:100%;border-collapse:collapse;text-align:left;font-size:13px;margin-top:7px}
th,td{padding:11px 9px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
th{font-size:11px;font-weight:750;letter-spacing:.03em;text-transform:uppercase}
td{min-width:82px}
td:has(.badge){min-width:70px}
tr:last-child td{border-bottom:0}
ul{padding-left:20px;margin:8px 0 0;color:var(--muted)}
li+li{margin-top:4px}
details{padding:10px 0;border-bottom:1px solid var(--line)}
details:last-child{border-bottom:0}
summary{cursor:pointer;font-weight:650}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;background:#f0f5f3;border-radius:8px;padding:12px;color:#395852;max-height:330px;overflow:auto}
.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,188px),1fr));gap:14px;margin:14px 0}
label{display:block;font-size:13px;font-weight:650}
label input{display:block;width:100%;margin-top:5px}
fieldset{border:0;padding:0;margin:0;min-width:0}
legend{padding:0;color:var(--muted);font-size:13px;margin-bottom:5px}
fieldset .row{flex-wrap:nowrap}
fieldset input{width:100%;min-width:64px}
.login{min-height:100svh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 25% 20%,#dceee6,transparent 63%)}
.login .panel{width:min(100%,435px);padding:32px}
.login h1{margin:13px 0 6px}
.login form{display:grid;gap:13px;margin-top:23px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.chart-header button,.pair-list button{min-height:34px;padding:5px 10px}
.pair-list{margin:7px 0 13px}
.chart-summary{gap:10px;margin:5px 0 2px}
.chart-summary strong{font-size:clamp(20px,3vw,28px);letter-spacing:-.04em}
.chart-summary span{font-weight:700;font-size:13px}
#market-chart{display:block;width:100%;height:clamp(225px,32vw,327px);touch-action:pan-y}
#chart-readout{font-size:12px;margin-top:6px;min-height:20px;font-variant-numeric:tabular-nums}
.online-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#5aa57d}
.report-stat{font-size:13px;color:var(--muted);margin-top:7px}
#brief .row{margin:10px 0}
#brief .row .badge{font-size:11px}
#journal td:nth-child(5){min-width:180px}
#journal td:nth-child(6){min-width:135px}
#active-strategy,#active-model,#proposal,#model-proposal{padding-top:9px}
.floor{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,2vw,23px);isolation:isolate;margin:18px 0;overflow:hidden;
  padding:clamp(8px,2vw,23px);background:#e0ece5;background-image:repeating-linear-gradient(0deg,#d7e5dc 0,#d7e5dc 1px,transparent 1px,transparent 37px);border:1px solid #d0e1d7;border-radius:15px}
.office-room{grid-column:1/-1;min-height:82px;border:1px solid #c7dcd3;border-radius:13px;background:#f3faf7;display:flex;align-items:center;justify-content:center;gap:12px;font-size:13px;color:#4e6c62}
.office-room i{width:27px;height:17px;background:#b6c9cf;border:2px solid #8caab3;border-radius:6px}
.desk{position:relative;overflow:visible;min-width:0;min-height:130px;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;padding:10px;gap:2px;text-align:left;border:1px solid #c8dbcf;background:#fffdf8;isolation:auto}
.desk-name,.desk-title,.desk-state{width:100%;overflow-wrap:anywhere}
.desk-name{font-size:14px;font-weight:750}
.desk-title,.desk-state{font-size:11px;font-weight:600;color:#4d6962}
.desk-state{color:#1e6b56}
.workstation{position:absolute;top:10px;right:13%;width:47%;height:39px;background:#e0ccac;border-radius:9px;border-bottom:5px solid #c3a981}
.monitor{position:absolute;left:19%;top:2px;width:65%;height:21px;border:3px solid #557373;border-radius:5px;background:#bce4db}
.monitor:after{content:'';position:absolute;left:10%;right:10%;top:38%;border-bottom:2px solid #73b09d;transform:rotate(-10deg)}
.keyboard{position:absolute;left:26%;bottom:2px;width:52%;height:5px;border-radius:2px;background:#75908a}
.person{position:absolute;left:12%;top:8px;z-index:3;display:block;width:29px;height:41px;--skin:#e6b58d;--hair:#342f32;--shirt:#5576ad}
.person .hair{position:absolute;width:19px;height:20px;left:5px;top:2px;background:var(--hair);border-radius:55% 55% 38% 32%}
.person .face{position:absolute;width:14px;height:15px;left:8px;top:7px;background:var(--skin);border-radius:44% 42% 48% 48%}
.person .face:after{content:'';position:absolute;left:3px;top:5px;width:2px;height:2px;background:#5d423a;box-shadow:5px 0 #5d423a;border-radius:50%}
.person .shirt{position:absolute;width:25px;height:18px;left:2px;top:22px;background:var(--shirt);border-radius:58% 57% 22% 24%;border-bottom:4px solid #405c6440}
.desk-news .person{--skin:#cf9876;--hair:#2f2428;--shirt:#b1785d}
.desk-strategy .person{--skin:#b9805a;--hair:#201f22;--shirt:#9a6190}
.desk-risk .person{--skin:#ac7254;--hair:#382b29;--shirt:#4c8a75}
.desk-learning .person{--skin:#edc39f;--hair:#873d2a;--shirt:#b08a42}
.desk-manager .person{--skin:#ddae86;--hair:#483b3a;--shirt:#61718f}
.desk.status-active{border-color:#83b6a8}
.desk-working .person .shirt{animation:typing .95s ease-in-out infinite}
.motion-off .person .shirt{animation:none}
.office-detail{padding:12px 0 0;border-top:1px solid var(--line)}
@keyframes typing{50%{transform:rotate(4deg)}}
@media(max-width:950px){.overview-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:650px){.split{grid-template-columns:1fr}.grid.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{margin-top:20px}.floor{grid-template-columns:repeat(2,minmax(0,1fr))}nav a{padding-inline:10px}}
@media(prefers-reduced-motion:reduce){.person .shirt{animation:none}}
`;

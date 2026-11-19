const css = String.raw`
:root{color-scheme:dark;--bg:#101218;--panel:#181b23;--line:#2a2f3b;--muted:#a5aec0;--ink:#f1f4fb;--accent:#a7eece;--warn:#f5ca87;--red:#ffaaa8;font:15px/1.5 system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink)}
main{width:min(1330px,100%);padding:32px clamp(16px,4vw,52px) 64px;margin:auto}
header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px;flex-wrap:wrap}
h1,h2,h3,p{margin:0}
h1{font-size:clamp(25px,4vw,38px);letter-spacing:-.05em}
h2{font-size:20px;letter-spacing:-.025em;margin-bottom:14px}
h3{font-size:15px;margin-bottom:8px}
p,small,label,th{color:var(--muted)}
a{color:var(--accent)}
nav{display:flex;flex-wrap:wrap;gap:10px 20px;padding:13px 0;border-block:1px solid var(--line);margin:0 0 26px}
nav a{font-size:14px;text-decoration:none;color:var(--muted)}
nav a:hover{color:var(--accent)}
section{scroll-margin-top:16px}
.panel{padding:20px;background:var(--panel);border:1px solid var(--line);border-radius:14px;min-width:0}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))}
.block{margin:26px 0 0}
.metric{font-size:27px;font-variant-numeric:tabular-nums;color:var(--ink);margin-top:4px;letter-spacing:-.04em}
.split{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:14px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.row-spread{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:6px;background:#242d2e;border:1px solid #354342;color:var(--accent);padding:3px 9px;border-radius:99px;font-size:13px}
.warning{color:var(--warn);background:#302a21;border-color:#564632}
.error{color:var(--red)}
button,select,input{font:inherit;border:1px solid #3b4353;border-radius:8px;background:#1e2330;color:var(--ink);padding:8px 12px}
button{cursor:pointer;font-weight:600}
button:hover{border-color:var(--accent)}
button:disabled{opacity:.48;cursor:default}
button.primary{background:var(--accent);color:#142c23;border-color:var(--accent)}
button.danger{background:#44272a;color:#ffd5d2;border-color:#77404a}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
#notice{min-height:23px;margin-bottom:12px;color:var(--warn)}
.table-wrap{overflow:auto}
table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}
th,td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;font-weight:650}
td{min-width:88px}
ul{padding-left:20px;margin:8px 0 0}
details{padding:9px 0;border-bottom:1px solid var(--line)}
summary{cursor:pointer}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:var(--bg);border-radius:8px;padding:12px;color:var(--muted);max-height:420px;overflow:auto}
.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,194px),1fr));gap:14px;margin:14px 0}
label{display:block;font-size:13px}
label input{display:block;width:100%;margin-top:5px}
fieldset{border:0;padding:0;margin:0;min-width:0}
legend{padding:0;color:var(--muted);font-size:13px;margin-bottom:5px}
fieldset .row{flex-wrap:nowrap}
fieldset input{width:100%;min-width:70px}
.cards{margin-bottom:14px}
.login{min-height:100svh;display:grid;place-items:center}
.login .panel{width:min(100%,450px);padding:32px}
.login form{display:grid;gap:13px;margin-top:23px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:820px){.split{grid-template-columns:1fr}}
`;
const signin = String.raw`
<main class="login"><section class="panel">
  <span class="badge">Binance Demo Spot</span>
  <h1>AI Trading Agent</h1>
  <p>Sign in to the private administrator dashboard.</p>
  <form id="signin" method="post" action="/api/session">
    <label for="password">Administrator password
      <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="512">
    </label>
    <button class="primary" type="submit">Sign in</button>
    <p id="notice" role="status"></p>
  </form>
</section></main>
`;
const signInScript = String.raw`
const form = document.getElementById('signin');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  const input = form.elements.password;
  button.disabled = true;
  const password = input.value;
  input.value = '';
  const notice = document.getElementById('notice');
  notice.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', password })
    });
    if (!response.ok) throw Error((await response.json()).error);
    location.replace('/');
  } catch (error) {
    notice.textContent = error.message || 'Sign-in unavailable';
    input.focus();
  } finally {
    button.disabled = false;
  }
});
`;
const dashboard = String.raw`
<main>
  <header>
    <div><div class="row"><span class="badge">Binance Demo Spot</span><span class="badge warning" id="mode">Checking execution</span></div>
    <h1>AI Trading Agent</h1><p>Portfolio, research and execution controls</p></div>
    <div class="row"><button class="danger" id="stop">Emergency stop</button><button id="logout">Sign out</button></div>
  </header>
  <nav aria-label="Dashboard sections">
    <a href="#portfolio">Portfolio</a><a href="#agents">Agents</a><a href="#journal">Activity</a>
    <a href="#trades">Trades</a><a href="#strategy">Strategy</a><a href="#risk">Risk</a><a href="#integrations">Integrations</a>
  </nav>
  <p id="notice" role="status"></p>

  <section id="portfolio">
    <h2>Portfolio</h2>
    <div class="grid cards" id="metrics"></div>
    <div class="panel"><h3>Tracked positions</h3><p>USDT values use a 1 USDT ≈ 1 USD reporting convention.</p><div id="positions" class="table-wrap"></div></div>
  </section>

  <section class="block" id="agents">
    <div class="row-spread"><h2>Agent monitoring</h2><button id="research">Run research cycle</button></div>
    <div id="agent-cards" class="grid"></div>
  </section>

  <section id="journal" class="block panel">
    <div class="row-spread"><h2>Activity and decisions</h2><div class="row"><button id="latest">Latest</button><button id="older">Older</button></div></div>
    <div id="activity"></div>
    <h3 class="block">Decision history</h3><div class="table-wrap" id="decisions"></div>
  </section>

  <section id="trades" class="block panel">
    <div class="row-spread"><h2>Trading history</h2><button id="exchange">Load exchange history</button></div>
    <h3>Platform fills on this journal page</h3><div class="table-wrap" id="fills"></div>
    <div id="exchange-history" class="table-wrap block"></div>
  </section>

  <section id="strategy" class="block split">
    <div class="panel"><h2>Strategy management</h2><div id="active-strategy"></div><div id="proposal"></div></div>
    <div class="panel"><h2>Learning reports</h2><div id="learning"></div></div>
  </section>

  <section id="risk" class="block panel">
    <h2>Risk settings</h2>
    <p>Spot only · 1× exposure · entry limits reserve full principal and a fee buffer · exits also count toward filled volume · daily limits use Gulf Standard Time</p>
    <form id="risk-form"><div class="fields" id="fields"></div><button type="submit" id="save">Save settings</button></form>
  </section>

  <section class="block split">
    <div class="panel"><h2>AI usage</h2><div id="ai"></div></div>
    <div id="integrations" class="panel"><div class="row-spread"><h2>Integration health</h2><button id="health">Check now</button></div>
      <div id="health-results"></div>
      <div class="row block"><button id="verify">Verify Demo order access</button><button id="resume">Resume Demo execution</button></div>
      <p id="schedule" class="block"></p>
    </div>
  </section>

  <section class="block panel"><div class="row-spread"><h2>Administrator audit</h2><div class="row"><button id="load-audit">Latest changes</button><button id="audit-older" disabled>Older</button></div></div><div id="audit"></div></section>
</main>
`;
const dashboardScript = String.raw`
const $ = id => document.getElementById(id);
const money = (value, precision = 2) => Number.isFinite(value) ?
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: precision, maximumFractionDigits: precision }).format(value) : '—';
const qty = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value) : '—';
const date = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' }) + ' GST' : '—';
const el = (tag, string, cls) => {
  const node = document.createElement(tag);
  if (string != null) node.textContent = string;
  if (cls) node.className = cls;
  return node;
};
const empty = text => el('p', text);
const detail = (title, value) => {
  const node = el('details');
  node.append(el('summary', title), el('pre', JSON.stringify(value, null, 2)));
  return node;
};
function table(target, headers, rows, message) {
  if (!rows.length) return target.replaceChildren(empty(message));
  const box = el('table');
  const head = box.createTHead().insertRow();
  headers.forEach(title => head.append(el('th', title)));
  const body = box.createTBody();
  rows.forEach(row => {
    const tr = body.insertRow();
    row.forEach(value => tr.append(el('td', value ?? '—')));
  });
  target.replaceChildren(box);
}
async function api(route, options) {
  const response = await fetch('/api/' + route, options);
  if (response.status === 401) {
    location.replace('/');
    throw Error('Session expired');
  }
  if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'Service unavailable');
  return response.json();
}
let state, cursor, auditCursor, olderPage = false, lastCycleAt, operationInProgress = false;
const names = ['Market Analyst', 'News Analyst', 'Strategy Agent', 'Risk Manager', 'Learning Agent'];
const amountKeys = {
  dailyVolume: 'Daily volume', maxPosition: 'Maximum position', riskPerTrade: 'Risk per trade',
  dailyLoss: 'Daily loss limit', monthlyLoss: 'Monthly loss limit'
};
const numbers = {
  capital: 'Allocated capital (USD)', maxTrades: 'New trades per day', maxOpenPositions: 'Simultaneous positions',
  aiMonthlyUsd: 'AI monthly ceiling (USD)', aiDailyCalls: 'AI requests per day'
};
function metric(title, value) {
  const node = el('article', null, 'panel');
  node.append(el('small', title), el('p', value, 'metric'));
  return node;
}
function renderSettings() {
  const target = $('fields');
  if (target.children.length) return;
  for (const [key, title] of Object.entries(numbers)) {
    const label = el('label', title);
    const input = el('input');
    Object.assign(input, { type: 'number', name: key, step: ['capital','aiMonthlyUsd'].includes(key) ? '0.01' : '1',
      min: key.startsWith('ai') ? '0' : '1', required: true, value: state.settings[key] });
    label.append(input);
    target.append(label);
  }
  for (const [key, title] of Object.entries(amountKeys)) {
    const node = el('fieldset');
    node.append(el('legend', title));
    const row = el('div', null, 'row');
    const input = el('input');
    Object.assign(input, { type: 'number', name: key, step: '0.01', min: '0.01', required: true, value: state.settings[key].value });
    input.setAttribute('aria-label', title + ' value');
    const select = el('select');
    select.name = key + 'Mode';
    select.setAttribute('aria-label', title + ' unit');
    for (const [mode, label] of [['usd','USD'],['percent','%']]) {
      const option = el('option', label);
      option.value = mode;
      option.selected = state.settings[key].mode === mode;
      select.append(option);
    }
    row.append(input, select);
    node.append(row);
    target.append(node);
  }
}
function renderAgents() {
  $('agent-cards').replaceChildren(...names.map(name => {
    const agent = state.latest[name];
    const node = el('article', null, 'panel');
    node.append(el('h3', name), el('span', agent?.status ?? 'Awaiting cycle', 'badge' + (agent?.error ? ' warning' : '')),
      el('p', date(agent?.at)));
    if (agent?.error) node.append(el('p', agent.error, 'error'));
    if (agent?.output) node.append(detail('Latest output', agent.output));
    return node;
  }));
}
function renderStrategy() {
  const s = state.strategy;
  $('active-strategy').replaceChildren(el('h3', s.id),
    el('p', 'SMA ' + s.fast + '/' + s.slow + ' · RSI ' + s.minRsi + '–' + s.maxRsi));
  const proposal = state.proposal;
  const box = $('proposal');
  if (!proposal) box.replaceChildren(empty('No pending strategy proposal.'));
  else {
    box.replaceChildren(detail('Pending proposal · ' + date(proposal.createdAt), proposal), el('p', proposal.reason));
    const buttons = el('div', null, 'row');
    for (const action of ['approve', 'reject']) {
      const btn = el('button', action === 'approve' ? 'Approve proposal' : 'Reject proposal');
      btn.disabled = action === 'approve' && (!state.stopped || Boolean(state.pending));
      btn.addEventListener('click', () => operate(btn, action, { proposal: proposal.id }));
      buttons.append(btn);
    }
    box.append(buttons);
  }
  const report = state.latest['Learning Agent'];
  if (!report?.output) $('learning').replaceChildren(empty(report?.error ?? 'No performance review has run.'));
  else {
    const { sample, weakness, evaluations } = report.output;
    $('learning').replaceChildren(el('p', date(report.at)), el('p', weakness),
      el('p', sample.closed + ' closed Demo results · ' + sample.wins + ' wins'),
      detail('Historical candle backtests · hypothetical', evaluations));
  }
}
function render() {
  $('mode').textContent = state.execution ? 'Demo execution enabled' : state.pending ? 'Reconciliation required' : 'Execution disabled';
  $('mode').classList.toggle('warning', !state.execution);
  $('resume').disabled = !state.stopped || !state.readyToResume || state.running;
  $('save').disabled = !state.stopped || Boolean(state.pending) || state.running;
  $('research').disabled = Boolean(state.running) || operationInProgress;
  $('verify').disabled = Boolean(state.running);
  $('schedule').textContent = state.cronConfigured ? 'Daily research schedule · 08:00 Gulf Standard Time window' : 'Schedule is waiting for CRON_SECRET configuration.';
  const positions = Object.entries(state.positions);
  $('metrics').replaceChildren(metric('Allocated capital', money(state.settings.capital)),
    metric('Realized P&L', money(state.realized)), metric('Open positions', String(positions.length)),
    metric('Today’s filled volume', money(state.day.volume)), metric('Today’s realized losses', money(state.day.loss)));
  const markets = state.latest['Market Analyst']?.output;
  table($('positions'), ['Pair', 'Quantity', 'Cost basis', 'Entry price', 'Last Demo close', 'Candle closed'],
    positions.map(([symbol, entry]) => [symbol, qty(entry.quantity), money(entry.cost), money(entry.price, 4),
      money(markets?.[symbol]?.price, 4), date(markets?.[symbol]?.closedAt)]), 'No positions opened by this platform.');
  renderAgents();
  renderStrategy();
  renderSettings();
  $('ai').replaceChildren(el('p', 'Estimated monthly spend ' + money(state.ai.usd, 4) + ' / ' + money(state.settings.aiMonthlyUsd)),
    el('p', state.aiCallsToday + ' / ' + state.settings.aiDailyCalls + ' requests today'),
    el('p', qty(state.ai.input) + ' input tokens · ' + qty(state.ai.output) + ' output tokens'),
    el('p', state.ai.unconfirmed + ' unconfirmed usage reservations retained in the budget'));
  if (state.pending) $('notice').textContent = 'Order reconciliation required for ' + state.pending.symbol + ' (' + state.pending.clientId + ').';
}
async function pageJournal(next) {
  const data = await api('research' + (next ? '?cursor=' + encodeURIComponent(next) : ''));
  olderPage = Boolean(next);
  cursor = data.next;
  $('older').disabled = !cursor;
  const items = data.items;
  const nodes = items.map(item => detail(date(item.finishedAt) + ' · ' + item.source + (item.error ? ' · degraded' : ''),
    { error: item.error, agents: item.agents }));
  $('activity').replaceChildren(...(nodes.length ? nodes : [empty('No recorded research cycles.')]));
  table($('decisions'), ['Time','Pair','Decision','Strategy','Rule and rationale','Risk evaluation'],
    items.flatMap(item => item.decisions || []).map(d => [date(d.timestamp),d.symbol,d.side,d.strategy,d.reason + (d.commentary ? ' · ' + d.commentary : ''),d.risk?.reason]),
    'No decisions on this journal page.');
  table($('fills'), ['Time','Pair','Side','Status','Quantity','Entry','Fill price','Fees','Net P&L','Strategy','Decision and risk'],
    items.flatMap(item => item.trades || []).map(t => [date(t.time),t.symbol,t.side,t.status,qty(t.quantity),
      money(t.entryPrice, 4),money(t.price, 4),money(t.feeUsd, 5),money(t.netProfit),t.strategy,t.reason + ' · ' + t.risk?.reason]),
    'No platform fills on this journal page.');
}
async function pageAudit(next) {
  const data = await api('research?kind=audit' + (next ? '&cursor=' + encodeURIComponent(next) : ''));
  auditCursor = data.next;
  $('audit-older').disabled = !auditCursor;
  $('audit').replaceChildren(...(data.items.length ? data.items.map(event =>
    detail(date(event.time) + ' · ' + event.action, event)) : [empty('No recorded administrator changes.')]));
}
async function refresh() {
  state = await api('control');
  render();
  const stamp = state.lastCycle?.at ?? null;
  if (!olderPage && stamp !== lastCycleAt) {
    await pageJournal();
    lastCycleAt = stamp;
  }
}
function post(body, csrf = true) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': state.csrf } : {}) },
    body: JSON.stringify(body) };
}
async function guarded(button, task) {
  button.disabled = true;
  try { await task(); }
  catch (error) { $('notice').textContent = error.message; }
  finally { button.disabled = false; }
}
async function operate(button, action, values = {}) {
  if (!state) return;
  if (action === 'resume' && !confirm('Resume Binance Demo Spot execution?')) return;
  if (action === 'research') operationInProgress = true;
  await guarded(button, async () => {
    $('notice').textContent = action === 'research' ? 'Research cycle running…' : 'Applying change…';
    const result = await api('control', post({ ...values, id: crypto.randomUUID(), action }));
    $('notice').textContent = result.status === 'degraded' ? 'Cycle recorded with service errors. See Activity.' :
      result.status === 'duplicate' ? 'Operation already recorded.' : 'Operation recorded.';
    if (action === 'settings') $('fields').replaceChildren();
    await refresh();
  });
  if (action === 'research') operationInProgress = false;
  render();
}
$('risk-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const settings = { ...state.settings };
  for (const key of Object.keys(numbers)) settings[key] = Number(data.get(key));
  for (const key of Object.keys(amountKeys)) settings[key] = { mode: data.get(key + 'Mode'), value: Number(data.get(key)) };
  void operate($('save'), 'settings', { settings });
});
for (const action of ['stop','resume','verify','research']) $(action).addEventListener('click', () => operate($(action), action));
$('latest').addEventListener('click', () => guarded($('latest'), () => pageJournal()));
$('older').addEventListener('click', async () => { await guarded($('older'), () => pageJournal(cursor)); $('older').disabled = !cursor; });
$('load-audit').addEventListener('click', () => guarded($('load-audit'), () => pageAudit()));
$('audit-older').addEventListener('click', async () => { await guarded($('audit-older'), () => pageAudit(auditCursor)); $('audit-older').disabled = !auditCursor; });
$('logout').addEventListener('click', () => guarded($('logout'), async () => {
  await api('session', post({ action: 'logout' }));
  location.replace('/');
}));
$('health').addEventListener('click', () => guarded($('health'), async () => {
  const { services } = await api('demo-status');
  const rows = Object.entries(services).map(([name, service]) => [
    ({ demoMarket:'Demo market',demoAccount:'Demo Spot account',openAI:'OpenAI',news:'News feed',gitHub:'GitHub data' })[name] ?? name,
    service.status, service.reason ?? service.model ?? (service.relevantHeadlines != null ? service.relevantHeadlines + ' relevant headlines' : '—')
  ]);
  table($('health-results'), ['Service','Status','Details'], rows, 'Health checks unavailable.');
}));
$('exchange').addEventListener('click', () => guarded($('exchange'), async () => {
  const { orders } = await api('demo-history');
  table($('exchange-history'), ['Time','Pair','Order','Side','Status','Quantity','Price','Fees','Origin'],
    orders.map(o => [date(o.time),o.symbol,o.orderId,o.side,o.status,qty(o.quantity),money(o.price, 4),
      o.fillCoverage ? Object.entries(o.fees).map(([asset, amount]) => qty(amount) + ' ' + asset).join(', ') || '—' : 'Incomplete coverage',o.origin]),
    'No recent orders in the Demo account for the configured pairs.');
}));
refresh().catch(error => { $('notice').textContent = error.message; });
setInterval(() => {
  if (document.visibilityState === 'visible') refresh().catch(error => { $('notice').textContent = error.message; });
}, 20000);
`;

export function page(nonce, authenticated) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>AI Trading Agent V1.0</title><style nonce="' + nonce + '">' + css + '</style></head><body>' +
    (authenticated ? dashboard : signin) + '<script nonce="' + nonce + '">' +
    (authenticated ? dashboardScript : signInScript) + '</script></body></html>';
}

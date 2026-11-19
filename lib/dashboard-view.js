import { css } from './dashboard-style.js';
import { dashboard } from './dashboard-layout.js';
import { chartScript } from './dashboard-charts.js';
import { officeScript } from './dashboard-office.js';
import { reportScript } from './dashboard-reports.js';
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
const empty = text => el('p', text, 'empty');
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
const names = ['Market Analyst', 'News Analyst', 'Strategy Agent', 'Risk Manager', 'Learning Agent', 'General Manager'];
const amountKeys = {
  dailyVolume: 'Daily volume', maxPosition: 'Maximum position', riskPerTrade: 'Risk per trade',
  dailyLoss: 'Daily loss limit', monthlyLoss: 'Monthly loss limit'
};
const numbers = {
  capital: 'Allocated capital (USD)', maxTrades: 'Daily order cap (entries and exits)', maxOpenPositions: 'Simultaneous positions',
  aiMonthlyUsd: 'AI monthly ceiling (USD)', aiDailyCalls: 'AI requests per day'
};
function metric(title, value) {
  const node = el('article', null, 'panel metric-card');
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
  const options = $('pair-options');
  const gold = state.goldPairs ?? [];
  options.replaceChildren(...(state.availablePairs ?? state.settings.pairs).map(symbol => {
    const label = el('label');
    const input = el('input');
    Object.assign(input, { type: 'checkbox', name: 'pairs', value: symbol, checked: state.settings.pairs.includes(symbol) });
    label.append(input, document.createTextNode(symbol.replace(/USDT$/, '') + (gold.includes(symbol) ? ' · Gold' : '')));
    return label;
  }));
}
function renderAgents() {
  $('agent-cards').replaceChildren(...names.map(name => {
    const agent = state.latest[name];
    const node = el('article', null, 'panel');
    const profile = officeTeam.find(person => person.agent === name);
    node.append(el('h3', profile?.name ?? name), el('p', profile?.title ?? name), el('span', agent?.status ?? 'Awaiting cycle', 'badge' + (agent?.error ? ' warning' : '')),
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
    if (report.output.neural) $('learning').append(detail('Holdout results by pair and strategy', report.output.neural));
    if (report.output.forwardPaper) $('learning').append(detail('Forward shadow tests using observed Demo candles', report.output.forwardPaper));
  }
}
function render() {
  $('mode').textContent = state.execution ? 'Demo execution enabled' : state.pending ? 'Reconciliation required' : 'Execution disabled';
  $('mode').classList.toggle('warning', !state.execution);
  $('resume').disabled = !state.stopped || !state.readyToResume || state.running;
  $('save').disabled = Boolean(state.pending) || state.running;
  $('research').disabled = Boolean(state.running) || operationInProgress;
  $('verify').disabled = Boolean(state.running);
  $('schedule').textContent = state.cronConfigured && state.environment === 'production'
    ? 'Hourly research windows · daily reports use Gulf Standard Time'
    : state.environment === 'preview' ? 'Preview research runs on demand during validation.'
      : 'Schedule is waiting for CRON_SECRET configuration.';
  $('preview-journal').hidden = state.environment !== 'production';
  $('cycle-summary').textContent = state.running ? 'Research cycle running' : state.lastCycle
    ? 'Last research cycle ' + date(state.lastCycle.at) + ' · ' + state.lastCycle.status
    : 'Market research, Demo positions and team activity.';
  const positions = Object.entries(state.positions);
  $('metrics').replaceChildren(metric('Allocated capital', money(state.settings.capital)),
    metric('Realized P&L', money(state.realized)), metric('Open positions', String(positions.length)), metric('Today’s orders', qty(state.day.orders ?? state.day.trades ?? 0) + ' / ' + state.settings.maxTrades),
    metric('Today’s filled volume', money(state.day.volume)), metric('Today’s realized losses', money(state.day.loss)));
  const markets = state.latest['Market Analyst']?.output;
  table($('positions'), ['Pair', 'Quantity', 'Cost basis', 'Entry price', 'Last Demo close', 'Candle closed'],
    positions.map(([symbol, entry]) => [symbol, qty(entry.quantity), money(entry.cost), money(entry.price, 4),
      money(markets?.[symbol]?.price, 4), date(markets?.[symbol]?.closedAt)]), 'No positions opened by this platform.');
  renderAgents();
  renderStrategy();
  renderSettings();
  renderChartPairs();
  renderOffice();
  renderReports();
  $('ai').replaceChildren(el('p', 'Estimated monthly spend ' + money(state.ai.usd, 4) + ' / ' + money(state.settings.aiMonthlyUsd)),
    el('p', state.aiCallsToday + ' / ' + state.settings.aiDailyCalls + ' requests today · ' +
      (state.aiCallsThisHour ?? 0) + ' / ' + (state.aiHourlyLimit ?? 10) + ' this hour'),
    el('p', qty(state.ai.input) + ' input tokens · ' + qty(state.ai.output) + ' output tokens'),
    el('p', state.ai.unconfirmed + ' unconfirmed usage reservations retained in the budget'));
  const benchmark = state.connectivityBenchmark;
  $('ai-benchmark').replaceChildren(benchmark ? detail('OpenAI completion checks · ' + benchmark.status, benchmark) :
    el('p', 'Waiting for the scheduled OpenAI quality check.', 'block'));
  if (state.pending) $('notice').textContent = 'Order reconciliation required for ' + state.pending.symbol + ' (' + state.pending.clientId + ').';
}
let archive = false;
let fillsCursor = null;
let activePage = 'overview';
const pages = ['overview', 'research', 'trades', 'office', 'reports', 'settings'];
function showPage() {
  const requested = location.hash.slice(1);
  activePage = pages.includes(requested) ? requested : 'overview';
  for (const name of pages) {
    $('tab-' + name).hidden = name !== activePage;
    const link = $('navigation').querySelector('[href="#' + name + '"]');
    if (name === activePage) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  updateOfficeVisibility();
  if (state && activePage === 'research') void guarded($('latest'), () => pageJournal());
  if (state && activePage === 'trades') void guarded($('fills-latest'), () => pageFills());
}
window.addEventListener('hashchange', showPage);

async function fetchJournal(next, scope) {
  const params = new URLSearchParams();
  if (next) params.set('cursor', next);
  if (scope) params.set('scope', scope);
  return api('research' + (params.size ? '?' + params : ''));
}
async function pageJournal(next) {
  const previous = archive;
  const data = await fetchJournal(next, archive ? 'preview' : null);
  if (archive !== previous) return;
  olderPage = Boolean(next);
  cursor = data.next;
  $('older').disabled = !cursor;
  const items = data.items;
  const nodes = items.map(item => detail(date(item.finishedAt) + ' · ' + item.source + (item.error ? ' · degraded' : ''),
    { error: item.error, agents: item.agents, forecastResults: item.forecastResults, qa: item.qa }));
  $('activity').replaceChildren(...(nodes.length ? nodes : [empty('No recorded research cycles.')]));
  table($('decisions'), ['Time','Pair','Signal','Strategy','Rationale','Risk evaluation','Score'],
    items.flatMap(item => item.decisions || []).map(d => [date(d.timestamp),d.symbol,d.side,d.strategy,
      (d.rule ? (state.entryRules?.[d.rule] ?? d.rule) + ' · ' : '') + (d.forecast ? d.commentary || d.reason : d.reason),
      d.side === 'HOLD' && !d.risk?.accepted ? 'No order proposed' : d.risk?.reason,
      Number.isFinite(d.forecast?.probability) ? (d.forecast.probability * 100).toFixed(1) + '%' : '—']),
    'No decisions on this journal page.');
}
async function pageFills(next) {
  const data = await fetchJournal(next);
  fillsCursor = data.next;
  $('fills-older').disabled = !fillsCursor;
  table($('fills'), ['Time','Pair','Side','Status','Quantity','Entry','Fill price','Fees','Net P&L','Strategy','Decision and risk'],
    data.items.flatMap(item => item.trades || []).map(t => [date(t.time),t.symbol,t.side,t.status,qty(t.quantity),
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
  if (stamp !== lastCycleAt) {
    if (activePage === 'research' && !olderPage && !archive) await pageJournal();
    if (activePage === 'trades' && lastCycleAt === undefined) await pageFills();
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
  settings.pairs = data.getAll('pairs');
  void operate($('save'), 'settings', { settings });
});
for (const action of ['stop','resume','verify','research']) $(action).addEventListener('click', () => operate($(action), action));
$('latest').addEventListener('click', () => guarded($('latest'), () => pageJournal()));
$('preview-journal').addEventListener('click', () => {
  archive = !archive;
  $('preview-journal').setAttribute('aria-pressed', String(archive));
  void guarded($('preview-journal'), () => pageJournal());
});
$('fills-latest').addEventListener('click', () => guarded($('fills-latest'), () => pageFills()));
$('fills-older').addEventListener('click', async () => {
  if (fillsCursor) await guarded($('fills-older'), () => pageFills(fillsCursor));
  $('fills-older').disabled = !fillsCursor;
});
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
showPage();
refresh().catch(error => { $("notice").textContent = error.message; });
setInterval(() => {
  if (document.visibilityState === 'visible') refresh().catch(error => { $('notice').textContent = error.message; });
}, 20000);
`;

export function page(nonce, authenticated) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>AI Trading Agent V1.0</title><style nonce="' + nonce + '">' + css + '</style></head><body>' +
    (authenticated ? dashboard : signin) + '<script nonce="' + nonce + '">' +
    (authenticated ? dashboardScript.replace('showPage();', chartScript + officeScript + reportScript + '\nshowPage();') : signInScript) + '</script></body></html>';
}

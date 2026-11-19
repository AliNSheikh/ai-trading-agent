import { chartMarkup } from './dashboard-charts.js';
import { officeMarkup } from './dashboard-office.js';

export const dashboard = String.raw`
<main>
  <header class="topbar">
    <div class="identity"><span class="mark" aria-hidden="true">↗</span><div>AI Trading Agent<small>BINANCE DEMO SPOT</small></div></div>
    <div class="row"><button class="danger" id="stop">Emergency stop</button><button id="logout">Sign out</button></div>
  </header>
  <div class="hero">
    <div><h1>Trading operations</h1><p id="cycle-summary">Market research, Demo positions and team activity.</p></div>
    <div class="row"><span class="badge warning" id="mode">Checking execution</span><button class="primary" id="research">Run research</button></div>
  </div>
  <nav id="navigation" aria-label="Dashboard pages">
    <a href="#overview" aria-current="page">Overview</a><a href="#research">Research</a><a href="#trades">Trades</a>
    <a href="#office">Office</a><a href="#reports">Reports</a><a href="#settings">Settings</a>
  </nav>
  <p id="notice" role="status"></p>

  <div id="tab-overview">
    <div class="grid cards" id="metrics" aria-label="Portfolio overview"></div>
    <div class="overview-layout">CHART_MODULE
      <div class="panel-stack">
        <section class="panel" id="brief"><h2>Manager’s briefing</h2><div id="briefing"></div></section>
        <section class="panel"><div class="row-spread"><h2>Tracked positions</h2><span class="badge">Spot</span></div>
          <p>USDT uses an approximate USD equivalent.</p><div id="positions" class="table-wrap"></div>
        </section>
      </div>
    </div>
  </div>

  <div id="tab-research" hidden>
    <section id="agents"><h2>Agent monitoring</h2><div id="agent-cards" class="grid block"></div></section>
    <section id="journal" class="block panel">
      <div class="row-spread"><h2>Research and decisions</h2><div class="row">
        <button id="preview-journal" hidden aria-pressed="false">Preview archive</button>
        <button id="latest">Latest</button><button id="older">Older</button>
      </div></div>
      <div id="activity"></div>
      <h3 class="block">Decision history</h3><div class="table-wrap" id="decisions"></div>
    </section>
  </div>

  <div id="tab-trades" hidden>
    <section class="panel">
      <div class="row-spread"><h2>Trading history</h2><div class="row">
        <button id="fills-latest">Latest fills</button><button id="fills-older">Older fills</button>
        <button id="exchange">Load exchange history</button>
      </div></div>
      <div class="table-wrap" id="fills"></div><div id="exchange-history" class="table-wrap block"></div>
    </section>
  </div>

  <div id="tab-office" hidden>OFFICE_MODULE</div>

  <div id="tab-reports" hidden>
    <div class="split">
      <section class="panel"><h2>Daily manager reports</h2><label class="block">Report date <select id="report-date"></select></label>
        <div id="manager-report" class="block"></div>
      </section>
      <section class="panel"><h2>Demo account test campaign</h2><div id="qa-status" class="block"></div></section>
    </div>
    <div class="split block">
      <section class="panel"><h2>Forecast models</h2><div id="active-model"></div><div id="model-proposal"></div></section>
      <section class="panel"><h2>Performance and lessons</h2><div id="learning"></div><div id="feedback"></div></section>
    </div>
  </div>

  <div id="tab-settings" hidden>
    <div class="split">
      <section class="panel"><h2>Risk settings</h2><p>Spot only, 1× exposure. Entries reserve full principal and a fee buffer. Daily limits use Gulf Standard Time.</p>
        <form id="risk-form"><div class="fields" id="fields"></div><button type="submit" id="save">Save settings</button></form>
      </section>
      <section class="panel"><h2>Strategy management</h2><div id="active-strategy"></div><div id="proposal"></div></section>
    </div>
    <div class="split block">
      <section class="panel"><h2>AI usage</h2><div id="ai"></div></section>
      <section class="panel" id="integrations"><div class="row-spread"><h2>Integration health</h2><button id="health">Check now</button></div>
        <div id="health-results"></div>
        <div class="row block"><button id="verify">Verify Demo order access</button><button id="resume">Resume Demo execution</button></div>
        <p id="schedule" class="block"></p>
      </section>
    </div>
    <section class="block panel"><div class="row-spread"><h2>Administrator audit</h2><div class="row">
      <button id="load-audit">Latest changes</button><button id="audit-older" disabled>Older</button>
    </div></div><div id="audit"></div></section>
  </div>
</main>
`.replace('CHART_MODULE', chartMarkup).replace('OFFICE_MODULE', officeMarkup);

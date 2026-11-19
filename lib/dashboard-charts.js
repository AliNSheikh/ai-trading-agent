export const chartMarkup = String.raw`
<section id="markets" class="panel market-panel">
  <div class="row-spread chart-header">
    <div><h2>Market charts</h2><p>Closed Binance Demo Spot candles</p></div>
    <div class="row" id="chart-ranges" role="group" aria-label="Chart range">
      <button data-range="1D" aria-pressed="true">1D</button><button data-range="1W" aria-pressed="false">1W</button>
      <button data-range="1M" aria-pressed="false">1M</button><button data-range="3M" aria-pressed="false">3M</button>
    </div>
  </div>
  <div id="chart-pairs" class="row pair-list" role="group" aria-label="Currency pair"></div>
  <div class="row chart-summary"><strong id="chart-price">—</strong><span id="chart-change"></span></div>
  <canvas id="market-chart" tabindex="0" aria-label="Market price and volume chart. Use Left and Right arrows to inspect candles." aria-describedby="chart-readout"></canvas>
  <p id="chart-readout">Waiting for Demo candles.</p>
</section>
`;

export const chartScript = String.raw`
const chart = { data: null, pair: null, range: '1D', hover: null, token: 0, loading: false };
const chartCanvas = $('market-chart');

function showCandle() {
  if (!chart.data) return;
  const last = chart.data.bars.at(-1);
  const change = (last.close / chart.data.bars[0].open - 1) * 100;
  $('chart-price').textContent = qty(last.close) + ' USDT';
  $('chart-change').textContent = (change > 0 ? '+' : '') + change.toFixed(2) + '% · ' + chart.range;
  $('chart-change').className = change < 0 ? 'negative' : 'positive';
  const active = chart.data.bars[chart.hover] ?? last;
  $('chart-readout').textContent = date(active.time) + ' · Open ' + qty(active.open) +
    ' · High ' + qty(active.high) + ' · Low ' + qty(active.low) + ' · Close ' + qty(active.close) +
    ' · Volume ' + qty(active.volume);
}
function drawChart() {
  const box = chartCanvas.getBoundingClientRect();
  if (box.width < 100 || box.height < 50) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  chartCanvas.width = Math.round(box.width * ratio);
  chartCanvas.height = Math.round(box.height * ratio);
  const ctx = chartCanvas.getContext('2d');
  ctx.scale(ratio, ratio);
  if (!chart.data) return;
  const bars = chart.data.bars;
  const left = 10, right = box.width - 78, top = 15, bottom = box.height - 64, width = right - left;
  const low = Math.min(...bars.map(row => row.low));
  const high = Math.max(...bars.map(row => row.high));
  const pad = Math.max((high - low) * 0.09, high * 0.0002);
  const min = low - pad;
  const max = high + pad;
  const volume = Math.max(1, ...bars.map(row => row.volume));
  const x = index => left + index / (bars.length - 1) * width;
  const y = price => bottom - (price - min) / (max - min) * (bottom - top);
  const color = '#137970';
  ctx.font = '11px system-ui';
  ctx.strokeStyle = '#dee8e5';
  ctx.fillStyle = '#516863';
  for (let step = 0; step <= 4; step++) {
    const price = min + (max - min) * (step / 4);
    const position = y(price);
    ctx.beginPath(); ctx.moveTo(left, position); ctx.lineTo(right, position); ctx.stroke();
    ctx.fillText(new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(price), right + 8, position + 3);
  }
  function line() {
    ctx.beginPath();
    ctx.moveTo(x(0), y(bars[0].close));
    for (let index = 1; index < bars.length; index++) ctx.lineTo(x(index), y(bars[index].close));
  }
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, '#92d6c9a0');
  gradient.addColorStop(1, '#e1f4ef12');
  line(); ctx.lineTo(right, bottom); ctx.lineTo(left, bottom); ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  line();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  bars.forEach((bar, index) => {
    ctx.fillStyle = bar.close >= bar.open ? '#8ccabf88' : '#d7a7a288';
    const height = 28 * bar.volume / volume;
    ctx.fillRect(x(index), bottom + 35 - height, Math.max(1, width / bars.length - 1), height);
  });
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', ...(chart.range === '1D' ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' })
  });
  ctx.fillStyle = '#516863';
  const tickCount = box.width < 480 ? 2 : 5;
  for (let step = 0; step < tickCount; step++) {
    const index = Math.round(step / (tickCount - 1) * (bars.length - 1));
    const label = formatter.format(bars[index].time);
    ctx.fillText(label, Math.min(x(index), right - ctx.measureText(label).width), bottom + 56);
  }
  if (chart.hover !== null) {
    const active = bars[chart.hover];
    ctx.strokeStyle = '#527d76';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x(chart.hover), top); ctx.lineTo(x(chart.hover), bottom + 35); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x(chart.hover), y(active.close), 4, 0, Math.PI * 2); ctx.fill();
  }
}
async function loadChart({ clear = false } = {}) {
  if (!chart.pair || (!clear && chart.loading)) return;
  const token = ++chart.token;
  chart.loading = true;
  if (clear) {
    chart.data = null;
    chart.hover = null;
    $('chart-price').textContent = '—';
    $('chart-change').textContent = '';
    $('chart-readout').textContent = 'Loading ' + chart.pair + ' Demo candles…';
    drawChart();
  }
  try {
    const data = await api('market?symbol=' + encodeURIComponent(chart.pair) + '&range=' + encodeURIComponent(chart.range));
    if (token !== chart.token) return;
    chart.data = data;
    if (chart.hover >= data.bars.length) chart.hover = null;
    showCandle();
    drawChart();
  } catch (error) {
    if (token === chart.token) $('chart-readout').textContent = error.message +
      (chart.data ? ' · Showing the last successful chart.' : '');
  } finally {
    if (token === chart.token) chart.loading = false;
  }
}
function renderChartPairs() {
  const target = $('chart-pairs');
  const pairs = state.settings.pairs;
  const oldPair = chart.pair;
  if (!pairs.includes(chart.pair)) chart.pair = pairs[0];
  if (target.dataset.pairs !== pairs.join(',')) {
    target.replaceChildren(...pairs.map(symbol => {
      const pair = el('button', symbol.replace(/USDT$/, ' / USDT'));
      pair.dataset.pair = symbol;
      pair.setAttribute('aria-pressed', String(chart.pair === symbol));
      pair.addEventListener('click', () => {
        chart.pair = symbol;
        for (const button of target.children) button.setAttribute('aria-pressed', String(button.dataset.pair === symbol));
        void loadChart({ clear: true });
      });
      return pair;
    }));
    target.dataset.pairs = pairs.join(',');
  }
  if (chart.pair !== oldPair) void loadChart({ clear: true });
}
for (const button of $('chart-ranges').querySelectorAll('button')) button.addEventListener('click', () => {
  chart.range = button.dataset.range;
  for (const choice of $('chart-ranges').querySelectorAll('button')) choice.setAttribute('aria-pressed', String(choice === button));
  void loadChart({ clear: true });
});
chartCanvas.addEventListener('pointermove', event => {
  if (!chart.data) return;
  const box = chartCanvas.getBoundingClientRect();
  const progress = (event.clientX - box.left - 10) / (box.width - 88);
  chart.hover = Math.max(0, Math.min(chart.data.bars.length - 1, Math.round(progress * (chart.data.bars.length - 1))));
  showCandle(); drawChart();
});
chartCanvas.addEventListener('pointerleave', () => { chart.hover = null; showCandle(); drawChart(); });
chartCanvas.addEventListener('keydown', event => {
  if (!chart.data || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const last = chart.data.bars.length - 1;
  chart.hover = Math.min(last, Math.max(0, (chart.hover ?? last) + (event.key === 'ArrowLeft' ? -1 : 1)));
  showCandle(); drawChart();
});
new ResizeObserver(drawChart).observe(chartCanvas);
setInterval(() => {
  if (document.visibilityState === 'visible' && !$('tab-overview').hidden) void loadChart();
}, 60000);
`;

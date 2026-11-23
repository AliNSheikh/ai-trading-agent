export const reportScript = String.raw`
let currentReportDay = null;
function reportContent(report, compact = false) {
  if (!report) return [el('p', 'No manager report has been recorded.', 'empty')];
  const work = el('div', null, 'row');
  work.append(el('span', report.cycles + ' cycles', 'badge'), el('span', report.fills + ' fills', 'badge'),
    el('span', report.degraded + ' degraded', 'badge' + (report.degraded ? ' warning' : '')));
  const list = el('ul');
  const activeTraining = Boolean(state?.training?.enabled);
  for (const line of report.priorities ?? []) {
    // Previously saved reports retain a legacy message that doesn't describe the
    // independently enabled Demo-training path. Display the live split status instead.
    if (activeTraining && line === 'Waiting for a forecast model to pass the evidence checks.') continue;
    list.append(el('li', line));
  }
  const execution = report.executionStatus;
  const status = el('div', null, 'block');
  const modelQualified = Boolean(state?.activeModel?.models && Object.keys(state.activeModel.models).length ||
    state?.autonomousModel?.models && Object.keys(state.autonomousModel.models).length);
  status.append(el('p', 'Forecast models: ' + (modelQualified ? 'Qualified model available' :
    'Testing in progress — no forecast model qualified yet'), modelQualified ? 'positive' : 'report-stat'));
  const training = state?.training;
  if (training) {
    const used = training.usedToday ?? 0;
    const cap = training.dailyExperimentalCap ?? 1;
    const detailLine = training.enabled ?
      'Protected Demo training: enabled · '+used+'/'+cap+' exploratory entries today · orders depend on a qualifying signal and risk checks' :
      'Protected Demo training: disabled';
    status.append(el('p', detailLine, training.enabled ? 'positive' : 'warning'));
  } else if (execution?.training) {
    status.append(el('p', 'Protected Demo training: ' + execution.training.description, 'report-stat'));
  }
  const rejected = Object.entries(report.reasons ?? {}).filter(([reason])=>!['hold','exit-approved','entry-approved'].includes(reason))
    .sort((a,b)=>b[1]-a[1]).slice(0,5);
  if (!compact && rejected.length) status.append(el('p',
    'Top blocked decisions: ' + rejected.map(([reason,count])=>reason+' ('+count+')').join(' · '), 'report-stat'));
  const directive = report.demoOrderDirective ?? execution?.lastManagerDecision;
  if (!compact && directive?.reason) status.append(el('p',
    'Manager decision: '+(directive.side ?? 'HOLD')+
    (directive.symbol?' · '+directive.symbol:'')+' — '+directive.reason, 'report-stat'));
  const output = [
    el('p', report.day + ' · ' + date(report.updatedAt), 'report-stat'), work, status, list
  ];
  if (!compact) output.push(
    el('p', 'Research signals · ' + report.decisions.BUY + ' BUY · ' + report.decisions.SELL + ' SELL · ' +
      report.decisions.HOLD + ' HOLD', 'report-stat'),
    el('p', 'Realized P&L ' + money(report.realized) + ' · ' + report.observedForecasts + ' scored forecasts · ' +
      (report.strategyTests ?? 0) + ' shadow signals', 'report-stat'),
    detail('Desk updates and decision checks', { agents: report.agents, reasons: report.reasons })
  );
  return output;
}
function renderReports() {
  const reports = state.managerReports ?? [];
  const datePicker = $('report-date');
  const key = reports.map(report => report.day).join(',');
  if (datePicker.dataset.days !== key) {
    currentReportDay = reports.some(report => report.day === currentReportDay) ? currentReportDay : reports[0]?.day ?? null;
    datePicker.replaceChildren(...reports.map(report => {
      const option = el('option', report.day);
      option.value = report.day;
      return option;
    }));
    if (currentReportDay) datePicker.value = currentReportDay;
    datePicker.disabled = !reports.length;
    datePicker.dataset.days = key;
  }
  $('briefing').replaceChildren(...reportContent(reports[0], true));
  $('manager-report').replaceChildren(...reportContent(reports.find(report => report.day === currentReportDay)));
  const qa = state.latestQA;
  $('qa-status').replaceChildren(el('p', 'Daily checks run through ' + state.qaThrough + ' GST.'));
  if (qa) $('qa-status').append(el('p', date(qa.completedAt) + ' · ' + qa.status, qa.status === 'passed' ? 'positive' : 'error'),
    detail('Demo, model and data checks', qa));
  else $('qa-status').append(el('p', 'Waiting for the first scheduled check.', 'empty'));

  const proposal = state.modelProposal;
  const active = state.activeModel;
  $('active-model').replaceChildren(el('p', active ?
    'Forecast model qualified: ' + active.version + ' · expires ' + date(active.expiresAt) :
    'Forecast-model validation: in progress. No model has passed independent evidence checks yet.'));
  if (!active && state.training?.enabled) $('active-model').append(el('p',
    'This does not disable protected exploratory Demo training. A manager-selected signal and all exchange/risk checks remain mandatory.',
    'report-stat'));
  if (state.training) $('active-model').append(el('p',
    'Protected Demo training: '+(state.training.enabled?'ON':'OFF')+
    ' · '+state.training.usedToday+'/'+state.training.dailyExperimentalCap+
    ' exploratory entries today · '+state.training.protection,
    state.training.enabled?'positive':'warning'));
  if (state.entryDiagnostics) {
    const d = state.entryDiagnostics;
    $('active-model').append(el('p', d.safeToOpenNewPositions ?
      'Demo entry risk gates are open; an actual strategy signal is still required.' :
      'Demo entries blocked by ' + d.blockers.length + ' safety checks.', d.safeToOpenNewPositions ? 'positive' : 'warning'));
    for (const blocker of d.blockers) $('active-model').append(el('p', blocker.code + ': ' + blocker.message, 'report-stat'));
    $('active-model').append(detail('Risk capacity and research diagnostics', {
      allocatedRiskUsd: d.tradingBudgetUsd, maximumEntryNotionalUsd: d.maximumEntryNotionalUsd,
      minimumDemoNotionalUsd: d.minimumDemoNotionalUsd,
      lastDecisionReasons: d.lastDecisionReasons, modelAssessment: d.modelAssessment
    }));
  }
  if (state.entryRules) $('active-model').append(el('p', Object.values(state.entryRules).join(' · '), 'report-stat'));
  if (active) $('active-model').append(detail('Approved model evidence', active.metrics));
  const box = $('model-proposal');
  box.replaceChildren(el('p', proposal ? 'Model awaiting review' : 'No forecast model awaiting approval.'));
  if (proposal) {
    box.append(detail('Out-of-sample evidence', proposal.metrics));
    const actions = el('div', null, 'row');
    for (const [action, label] of [['approve-model','Approve model'], ['reject-model','Reject model']]) {
      const btn = el('button', label);
      btn.disabled = action === 'approve-model' && (!state.stopped || Boolean(state.pending) || state.running);
      btn.addEventListener('click', () => operate(btn, action, { proposal: proposal.id }));
      actions.append(btn);
    }
    box.append(actions);
  }
  const feedback = state.feedback;
  $('feedback').replaceChildren();
  if (feedback) {
    $('feedback').append(el('h3', 'Mistake log', 'block'),
      el('p', feedback.errors.length + ' distinct agent issues · ' + feedback.losses.length + ' reviewed losing fills'),
      detail('Agent errors and trade lessons', feedback));
  }
}
$('report-date').addEventListener('change', () => { currentReportDay = $('report-date').value; renderReports(); });
`;

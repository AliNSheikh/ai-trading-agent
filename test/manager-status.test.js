import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managerExecutionStatus, managerReport } from '../lib/review.js';
import { periods } from '../lib/settings.js';

const day = periods().day;
function state() {
 return {
   activeModel:null,autonomousModel:null,stopped:false,pending:null,
   days:{[day]:{experimental:0}},managerReports:{},realized:0,
   performance:{closed:0,wins:0,losses:0,fees:0}
 };
}
test('models can remain unqualified while protected Demo training is enabled', () => {
 const status=managerExecutionStatus(state(),{trainingEnabled:true});
 assert.equal(status.forecast.status,'researching');
 assert.equal(status.training.status,'monitoring');
 assert.match(status.training.description,/enabled/);
});
test('manager training pauses on emergency stop, pending exchange order or daily cap', () => {
 const emergency=state();emergency.stopped=true;
 assert.equal(managerExecutionStatus(emergency,{trainingEnabled:true}).training.status,'paused');
 const pending=state();pending.pending={kind:'opoco'};
 assert.match(managerExecutionStatus(pending,{trainingEnabled:true}).training.description,/reconciliation/);
 const capped=state();capped.days[day].experimental=1;
 assert.match(managerExecutionStatus(capped,{trainingEnabled:true}).training.description,/cap reached/);
});
test('manager explains independent forecast research and training without misleading legacy message', () => {
 const record={
   startedAt:new Date().toISOString(),decisions:[{
     side:'BUY',risk:{accepted:false,code:'minimum',reason:'Notional below exchange minimum'},testedRules:['trend']
   }],trades:[],forecastResults:[],agents:[],
   managerOrder:{side:'HOLD',reason:'No candidate passed the volatility and momentum checks'}
 };
 const report=managerReport(state(),record,{losses:[],errors:[]});
 assert.equal(report.executionStatus.forecast.status,'researching');
 assert.ok(report.priorities.some(p=>p.startsWith('Forecast research:')));
 assert.ok(report.priorities.some(p=>p.startsWith('General Manager:')));
 assert.ok(report.priorities.every(p=>!p.includes('Waiting for a forecast model to pass')));
 assert.equal(report.reasons.minimum,1);
});

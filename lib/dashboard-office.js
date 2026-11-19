import { team } from './review.js';

const desks = team.map(person => '<button type="button" class="desk desk-' + person.desk + '" data-agent="' + person.agent +
  '" aria-pressed="false"><span class="workstation" aria-hidden="true"><i class="monitor"></i><i class="keyboard"></i></span>' +
  '<span aria-hidden="true" class="person"><i class="hair"></i><i class="face"></i><i class="shirt"></i></span>' +
  '<span class="desk-name">' + person.name + '</span><span class="desk-title">' + person.title +
  '</span><span class="desk-state">Awaiting cycle</span></button>').join('');

export const officeMarkup = String.raw`
<section class="panel office-panel">
  <div class="row-spread">
    <div><h2>Research office</h2><p>Select a desk to see its work. Movement is an illustration of the office.</p></div>
    <div class="row"><button id="office-motion" type="button" aria-pressed="true">Office animation</button>
      <button id="office-walk" type="button">Walk to meeting room</button></div>
  </div>
  <div id="floor" class="floor" aria-label="Interactive office floor">
    <div class="office-room" aria-hidden="true"><span>Meeting room</span><i></i><i></i><i></i></div>
    OFFICE_DESKS
  </div>
  <div id="office-detail" class="office-detail" aria-live="polite"></div>
</section>
`.replace('OFFICE_DESKS', desks);

export const officeScript = 'const officeTeam = ' + JSON.stringify(team) + ';' + String.raw`
const deskButtons = [...$('floor').querySelectorAll('.desk')];
let selectedDesk = 'General Manager';
let motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let walking;
let away = false;
$('office-motion').setAttribute('aria-pressed', String(motion));

function renderOffice() {
  if (!state) return;
  const profile = officeTeam.find(person => person.agent === selectedDesk);
  const current = state.latest[selectedDesk];
  for (const desk of deskButtons) {
    desk.setAttribute('aria-pressed', String(desk.dataset.agent === selectedDesk));
    const status = state.latest[desk.dataset.agent]?.status ?? 'Awaiting cycle';
    desk.querySelector('.desk-state').textContent = status;
    desk.classList.toggle('desk-working', status === 'complete' && state.running);
  }
  $('office-detail').replaceChildren(el('h3', profile.name + ' · ' + profile.title),
    el('p', current ? 'Latest cycle ' + date(current.at) + ' · ' + current.status : 'No activity recorded for this desk yet.'));
  if (current?.error) $('office-detail').append(el('p', current.error, 'error'));
}
function walk() {
  const currentDesk = deskButtons.find(desk => desk.dataset.agent === selectedDesk);
  const character = currentDesk.querySelector('.person');
  walking?.cancel();
  if (away) {
    away = false;
    $('office-walk').textContent = 'Walk to meeting room';
    return;
  }
  const from = character.getBoundingClientRect();
  const destination = $('floor').querySelector('.office-room').getBoundingClientRect();
  const dx = destination.left + destination.width / 2 - from.left - from.width / 2;
  const dy = destination.top + destination.height / 2 - from.top - from.height / 2;
  const move = (x, y) => 'translate(' + x + 'px, ' + y + 'px)';
  walking = character.animate([
    { transform: move(0, 0) }, { transform: move(dx * 0.20, dy * 0.30) }, { transform: move(dx, dy) }
  ], { duration: motion ? 1100 : 1, easing: 'ease-in-out', fill: 'forwards' });
  away = true;
  $('office-walk').textContent = 'Return to desk';
}
for (const desk of deskButtons) desk.addEventListener('click', () => {
  if (away) walk();
  selectedDesk = desk.dataset.agent;
  renderOffice();
});
$('office-walk').addEventListener('click', walk);
$('office-motion').addEventListener('click', () => {
  motion = !motion;
  $('floor').classList.toggle('motion-off', !motion);
  $('office-motion').setAttribute('aria-pressed', String(motion));
});
$('floor').classList.toggle('motion-off', !motion);
`;

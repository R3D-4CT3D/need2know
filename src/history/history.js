import { api } from '../shared/api.js';
import { GRADES, gradeFor } from '../shared/scoring.js';
import { TECHNIQUES } from '../shared/techniques.js';

const $ = id => document.getElementById(id);
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; n.append(c instanceof Node ? c : String(c)); }
  return n;
}
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let sites = [];

async function load() {
  const { history = {} } = await api.storage.local.get('history');
  sites = Object.values(history).sort((a, b) => b.maxScore - a.maxScore || b.lastSeen - a.lastSeen);
  const heavy = sites.filter(s => s.maxScore >= 25).length;
  $('summary').textContent = sites.length
    ? `${sites.length} site${sites.length === 1 ? '' : 's'} probed your browser. ${heavy} actively fingerprinted you.`
    : 'Nothing recorded yet. Browse normally and check back.';
  render();
}

function render() {
  const q = $('filter').value.trim().toLowerCase();
  $('rows').replaceChildren(...sites.filter(s => s.host.includes(q)).map(s => {
    const pill = el('span', { class: 'pill', text: s.maxScore, title: `Worst seen. Last visit: ${s.score}` });
    pill.style.setProperty('--grade', `var(${GRADES[gradeFor(s.maxScore)].token})`);
    return el('tr', {},
      el('td', { class: 'site', text: s.host }),
      el('td', {}, pill),
      el('td', { class: 'caught' }, el('div', { class: 'chips' }, s.caught.map(id => el('span', { text: TECHNIQUES[id]?.title ?? id })))),
      el('td', { class: 'when', text: when(s.lastSeen) }));
  }));
}

$('filter').addEventListener('input', render);
$('clear').addEventListener('click', async () => {
  if (!confirm('Delete the record of every site this extension has seen?')) return;
  await api.storage.local.remove('history');
  load();
});
load();

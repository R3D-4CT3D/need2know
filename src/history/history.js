import { api } from '../shared/api.js';
import { GRADES, gradeFor } from '../shared/scoring.js';
import { TECHNIQUES } from '../shared/techniques.js';
import { followers, weekSummary } from '../shared/insights.js';
import { loadSettings, saveSettings } from '../shared/settings.js';
import { siteOf } from '../shared/domain.js';
import { asRequest } from '../shared/letters.js';

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

let history = {};
let sites = [];
let requests = {};

async function load() {
  ({ history = {}, requests = {} } = await api.storage.local.get(['history', 'requests']));
  sites = Object.values(history).sort((a, b) => b.maxScore - a.maxScore || b.lastSeen - a.lastSeen);
  const heavy = sites.filter(s => s.maxScore >= 25).length;
  $('summary').textContent = sites.length
    ? `${sites.length} site${sites.length === 1 ? '' : 's'} probed your browser. ${heavy} actively fingerprinted you.`
    : 'Nothing recorded yet. Browse normally and check back.';

  const w = weekSummary(history, requests);
  const date = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const items = [];
  if (w.sites) items.push(el('li', { text: `${w.sites} site${w.sites === 1 ? '' : 's'} probed your browser, ${w.heavy} actively fingerprinted you.` }));
  if (w.followers.length) items.push(el('li', { text: `Followed you across sites: ${w.followers.map(f => `${f.vendor ?? f.site} (${f.count} sites)`).join(', ')}.` }));
  for (const r of w.overdue) items.push(el('li', { class: 'late', text: `${r.host} hasn't replied to your deletion request (due ${date(r.dueAt)}).` }));
  for (const r of w.dueSoon) items.push(el('li', { text: `${r.host} must reply to your deletion request by ${date(r.dueAt)}.` }));
  $('week').hidden = !items.length;
  $('week-list').replaceChildren(...items);

  const top = followers(history);
  $('follow').hidden = !top.length;
  const max = top[0]?.count ?? 1;
  $('bars').replaceChildren(...top.map(f => {
    const bar = el('span');
    bar.style.width = `${Math.round(f.count / max * 100)}%`;
    return el('li', { title: f.sites.join(', ') },
      el('div', { class: 'who' }, f.vendor ? [el('b', { text: f.vendor }), ' ', el('span', { text: f.site })] : el('span', { text: f.site })),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, bar),
      el('div', { class: 'n', text: `${f.count} sites` }));
  }));
  render();
}

const short = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
function requestCell(host) {
  const r = asRequest(requests[host]);
  const href = `../request/request.html?host=${encodeURIComponent(host)}`;
  if (!r) return el('a', { href, text: 'Request deletion' });
  const late = Date.now() > r.dueAt;
  return el('a', { href, class: late ? 'late' : 'sent', title: `Sent ${short(r.sentAt)}` },
    late ? `Reply overdue since ${short(r.dueAt)}` : `Sent ${short(r.sentAt)} · reply due ${short(r.dueAt)}`);
}

function neverButton(host) {
  const b = el('button', { text: 'Never record' });
  b.addEventListener('click', async () => {
    const site = siteOf(host);
    if (!confirm(`Delete ${site} from history and never record it again? You can undo this in Settings.`)) return;
    const settings = await loadSettings(api);
    await saveSettings(api, { historyExclude: [...new Set([...settings.historyExclude, site])] });
    for (const h of Object.keys(history)) if (siteOf(h) === site) delete history[h];
    await api.storage.local.set({ history });
    load();
  });
  return b;
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
      el('td', { class: 'when', text: when(s.lastSeen) }),
      el('td', { class: 'req' }, requestCell(s.host), neverButton(s.host)));
  }));
}

$('filter').addEventListener('input', render);
$('export').addEventListener('click', () => {
  const data = { exportedAt: new Date().toISOString(), tool: 'What Sites See', version: api.runtime.getManifest().version, sites: history, deletionRequests: requests };
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'what-sites-see-history.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('clear').addEventListener('click', async () => {
  if (!confirm('Delete the record of every site this extension has seen?')) return;
  await api.storage.local.remove('history');
  load();
});
load();

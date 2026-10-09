import { api } from '../shared/api.js';
import { buildReport, GRADES } from '../shared/scoring.js';
import { evidenceRecord, sealEvidence } from '../shared/evidence.js';

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

const tabId = Number(new URLSearchParams(location.search).get('tab'));
const key = 'tab:' + tabId;
const state = (await api.storage.session.get(key))[key];

if (!state) {
  $('title').textContent = 'Nothing to report';
  $('empty').hidden = false;
} else {
  // Snapshot once, so the page, the JSON and the hash all describe the same moment.
  const report = buildReport(state);
  const record = evidenceRecord(report, state, {
    version: api.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    generatedAt: Date.now(),
  });
  const { sha256 } = await sealEvidence(record);

  document.title = `Evidence Report: ${report.host}`;
  $('title').textContent = report.host;
  $('m-url').textContent = report.url;
  $('m-when').textContent = new Date(record.generatedAt).toLocaleString([], { dateStyle: 'long', timeStyle: 'long' });
  $('m-ua').textContent = record.browser;
  $('m-protect').textContent = report.protect ? 'On: noise and generic values were returned to the page' : 'Off: the page received real values';
  $('m-score').textContent = `${report.score}/100 (${GRADES[report.grade].label})`;
  $('m-tool').textContent = `${record.tool.name} ${record.tool.version}`;

  const outcome = { active: ['Got through', 'no'], partial: ['Partly stopped', 'ok'], neutralized: ['Neutralized', 'ok'], blocked: ['Blocked', 'ok'] };
  $('rows').replaceChildren(...report.items.map(i => {
    const [text, cls] = outcome[i.status];
    return el('tr', {},
      el('td', {}, i.title),
      el('td', { class: cls, text }),
      el('td', { class: 'n', text: i.count }),
      el('td', { class: 'src' }, i.scripts.length ? i.scripts.flatMap((s, n) => [n ? el('br') : null, s.vendor ? `${s.vendor}: ${s.host}` : s.url, s.thirdParty ? ' (third party)' : '']) : 'unattributed'));
  }));
  $('sites').textContent = report.thirdPartySites.join('  ·  ') || 'None';
  $('hash').textContent = sha256;
  $('doc').hidden = false;

  $('print').addEventListener('click', () => print());
  $('json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ sha256, record }, null, 2) + '\n'], { type: 'application/json' });
    const stamp = record.generatedAt.replace(/[:.]/g, '-');
    const a = el('a', { href: URL.createObjectURL(blob), download: `evidence-${report.host}-${stamp}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

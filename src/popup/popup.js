import { api } from '../shared/api.js';
import { buildReport, GRADES } from '../shared/scoring.js';

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

// popup.html?tab=123 shows a specific tab's report, so tests can open the popup as a page.
const forced = Number(new URLSearchParams(location.search).get('tab'));
const tab = forced ? await api.tabs.get(forced) : (await api.tabs.query({ active: true, currentWindow: true }))[0];
const key = 'tab:' + tab?.id;

$('open-history').addEventListener('click', () => {
  api.tabs.create({ url: api.runtime.getURL('history/history.html') });
  window.close();
});

// Firefox treats <all_urls> as opt-in, so the user may need to grant it. In Chromium it's
// granted at install and this resolves true. permissions.request() must run directly inside
// the click handler, with no await before it, or the browser rejects it as not user-initiated.
const ALL = { origins: ['<all_urls>'] };
if (!(await api.permissions.contains(ALL).catch(() => true))) {
  $('perm').hidden = false;
  $('grant').addEventListener('click', () => {
    api.permissions.request(ALL).then(ok => { if (ok) { $('perm').hidden = true; api.tabs.reload(tab.id); } });
  });
}

function render(state) {
  const r = buildReport(state ?? { url: tab?.url ?? '' });
  const g = GRADES[r.grade];
  document.body.style.setProperty('--grade', `var(${g.token})`);
  $('host').textContent = r.host;
  $('score').textContent = state ? r.score : '–';
  $('fill').style.width = `${r.score}%`;
  $('label').textContent = state ? g.label : 'No report for this page';

  const third = r.items.filter(i => i.scripts.some(s => s.thirdParty)).length;
  $('sub').textContent = !state ? ''
    : r.items.length ? `${r.items.length} technique${r.items.length === 1 ? '' : 's'} caught${third ? `, ${third} by other companies' scripts` : ''}.`
    : 'Watching. Some scripts wait until you scroll, type or click.';

  $('items').replaceChildren(...r.items.map(item => el('li', { class: 'item' },
    el('div', { class: 'top' }, el('span', { text: item.title }), el('span', { class: 'pts', text: `+${item.weight}` })),
    el('p', { class: 'why', text: item.why }),
    item.scripts.length ? el('ul', { class: 'scripts' }, item.scripts.slice(0, 6).map(s =>
      el('li', { class: s.thirdParty ? 'third' : null, title: s.url },
        `${s.host}${s.file ? ' · ' + s.file : ''}`,
        s.count > 1 ? ` ×${s.count}` : '',
        s.thirdParty ? el('span', { class: 'tag', text: ' · 3rd party' }) : null))) : null)));

  const restricted = !/^(https?|file):/.test(tab?.url ?? '');
  $('empty').hidden = !!state && !restricted;
  $('empty').textContent = restricted
    ? 'Browsers don\'t let extensions run on built-in pages like this one.'
    : 'Nothing has reported from this page yet. If it was already open when you installed the extension, reload it. Browsers also block extensions on their own add-on stores.';

  $('hosts').hidden = !r.thirdPartySites.length;
  $('hosts-sum').textContent = `Contacted ${r.thirdPartySites.length} other compan${r.thirdPartySites.length === 1 ? 'y\'s domain' : 'ies\' domains'}`;
  $('hosts-list').replaceChildren(...r.thirdPartySites.map(s => el('li', { text: s })));
}

// Poll instead of storage.onChanged: storage.session change events aren't consistent across
// browsers yet, and a 1-second read of one key is cheap.
let last;
async function refresh() {
  const state = (await api.storage.session.get(key))[key];
  const json = JSON.stringify(state ?? null);
  if (json !== last) { last = json; render(state); }
}
await refresh();
setInterval(refresh, 1000);

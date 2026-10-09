import { api } from '../shared/api.js';
import { buildReport, GRADES } from '../shared/scoring.js';
import { siteOf } from '../shared/domain.js';
import { loadSettings, siteMode } from '../shared/settings.js';
import { adviceFor, browserTip, detectBrowser } from '../shared/guides.js';

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
const browser = await detectBrowser();
let settings = await loadSettings(api);
const webPage = /^https?:/.test(tab?.url ?? '');
const site = webPage ? siteOf(new URL(tab.url).hostname) : '';

for (const b of document.querySelectorAll('[data-open]')) {
  b.addEventListener('click', () => {
    if (b.dataset.open.startsWith('options/')) api.runtime.openOptionsPage();
    else api.tabs.create({ url: api.runtime.getURL(b.dataset.open) });
    window.close();
  });
}

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

/* ---------- per-site protection switch ---------- */
// The switch shows the setting for this site; the line under it says if the page that's
// actually loaded differs (e.g. it was open before the setting changed).
let pageProtected = null; // what the loaded page reported, once we know
function renderShield() {
  $('shield').hidden = !webPage;
  const { on, custom } = siteMode(settings, site);
  $('protect-site').checked = on;
  $('shield-label').textContent = on ? 'Protection on' : 'Protection off';
  const mode = $('shield-mode');
  if (custom) {
    const reset = el('button', { text: 'use default' });
    reset.addEventListener('click', () => setSite(settings.protectDefault));
    mode.replaceChildren('Set for this site · ', reset);
  } else {
    mode.replaceChildren(`Your default for all sites`);
  }
  const mismatch = pageProtected !== null && pageProtected !== on;
  $('mismatch').hidden = !mismatch;
  $('mismatch-text').textContent = on
    ? 'This page loaded before protection was on, so it isn\'t protected yet.'
    : 'This page is still protected until you reload it.';
}
async function setSite(on) {
  $('shield').classList.add('busy');
  // The background saves, re-registers scripts and rules, then reloads the tab.
  await api.runtime.sendMessage({ type: 'set-site', site, on, tabId: tab.id });
  settings = await loadSettings(api);
  pageProtected = null;
  $('shield').classList.remove('busy');
  last = null;
  renderShield();
  refresh();
}
$('protect-site').addEventListener('change', e => setSite(e.target.checked));
$('reload').addEventListener('click', () => { api.tabs.reload(tab.id); pageProtected = null; renderShield(); });
renderShield();

/* ---------- report ---------- */
function render(state) {
  const r = buildReport(state ?? { url: tab?.url ?? '' });
  if (state && webPage) {
    // With every defense switched off there's nothing to inject, so no mismatch to report.
    pageProtected = Object.values(settings.defenses).some(Boolean) ? r.protect : siteMode(settings, site).on;
    renderShield();
  }
  const g = GRADES[r.grade];
  document.body.style.setProperty('--grade', `var(${g.token})`);
  $('host').textContent = r.host;
  $('score').textContent = state ? r.score : '–';
  $('fill').style.width = `${r.score}%`;
  $('label').textContent = state ? g.label : 'No report for this page';

  const n = r.items.length;
  $('sub').textContent = !state ? ''
    : n ? `${n} technique${n === 1 ? '' : 's'} tried. ${r.stopped ? `${r.stopped} stopped.` : 'None stopped.'}`
    : 'Watching. Some scripts wait until you scroll, type or click.';

  // What still needs attention first; fully stopped techniques collapse to one line each.
  const context = { settings, siteOn: siteMode(settings, site).on };
  const rank = { active: 0, partial: 1, neutralized: 2, blocked: 2 };
  const ordered = [...r.items].sort((a, b) => rank[a.status] - rank[b.status]);
  $('items').replaceChildren(...ordered.map(item => {
    const advice = adviceFor(item, browser, context);
    const stopped = item.status !== 'active';
    const compact = item.status === 'neutralized' || item.status === 'blocked';
    if (compact) {
      return el('li', { class: 'item stopped', title: item.why },
        el('div', { class: 'top' }, el('span', { text: item.title }), el('span', { class: 'pts', text: `+${item.weight}` })),
        el('p', { class: 'status ok', text: `✓ ${item.status === 'blocked' ? 'Blocked' : 'Neutralized'} · ${item.scripts.map(s => s.host).filter((h, i, a) => a.indexOf(h) === i).slice(0, 3).join(', ')}` }));
    }
    return el('li', { class: 'item' },
      el('div', { class: 'top' }, el('span', { text: item.title }), el('span', { class: 'pts', text: `+${item.weight}` })),
      el('p', { class: 'why', text: item.why }),
      item.scripts.length ? el('ul', { class: 'scripts' }, item.scripts.slice(0, 6).map(s =>
        el('li', { class: s.thirdParty ? 'third' : null, title: s.url },
          `${s.host}${s.file ? ' · ' + s.file : ''}`,
          s.count > 1 ? ` ×${s.count}` : '',
          s.thirdParty ? el('span', { class: 'tag', text: ' · 3rd party' }) : null))) : null,
      advice.done
        ? el('p', { class: 'status ok', text: `✓ ${advice.done}` })
        : el('p', { class: 'status no', text: '✗ Not blocked: this one worked on you' }),
      advice.steps.length ? el('details', { class: 'fix' },
        el('summary', { text: stopped ? 'More you can do' : 'How to stop this' }),
        el('ol', {}, advice.steps.map(s => el('li', { text: s })))) : null);
  }));

  $('act').hidden = !webPage || !r.items.length;
  const unstopped = r.items.some(i => i.status === 'active' || i.status === 'partial');
  $('tip').hidden = !unstopped;
  $('tip').textContent = browserTip(browser);

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

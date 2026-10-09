import { api } from '../shared/api.js';
import { loadSettings, saveSettings, normalize, DEFAULTS, DEFENSES } from '../shared/settings.js';
import { detectBrowser } from '../shared/guides.js';
import { VENDORS } from '../shared/vendors.js';
import { siteOf } from '../shared/domain.js';

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
let settings = await loadSettings(api);

// A short notice in the corner, shown only when there's something to say.
let noticeTimer = 0;
function notice(text) {
  $('saved').textContent = text;
  $('saved').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('saved').hidden = true; }, 4000);
}

async function save(patch, message = 'Saved. Reload open pages to apply.') {
  settings = await saveSettings(api, patch);
  render();
  notice(message);
}

/* ---------- controls built from data ---------- */
$('defenses').append(...Object.entries(DEFENSES).map(([key, d]) =>
  el('label', { class: 'opt' }, el('input', { type: 'checkbox', 'data-defense': key }), el('span', {}, el('b', { text: d.title }), d.detail))));

const KINDS = { replay: 'Session recorders', fingerprint: 'Fingerprinting services', fraud: 'Fraud detection', bot: 'Bot detection' };
$('vendors').append(...Object.entries(KINDS).flatMap(([kind, label]) => [
  el('p', { class: 'kind', text: label }),
  el('div', { class: 'list' }, VENDORS.filter(v => v.kind === kind).map(v =>
    el('label', {}, el('input', { type: 'checkbox', 'data-vendor': v.name }), v.name))),
]));

/* ---------- render ---------- */
function render() {
  for (const r of document.querySelectorAll('input[name=protectDefault]')) r.checked = r.value === String(settings.protectDefault);
  for (const box of document.querySelectorAll('input[data-key]')) box.checked = !!settings[box.dataset.key];
  for (const sel of document.querySelectorAll('select[data-key]')) sel.value = String(settings[sel.dataset.key]);
  for (const box of document.querySelectorAll('input[data-defense]')) box.checked = !!settings.defenses[box.dataset.defense];
  for (const box of document.querySelectorAll('input[data-vendor]')) box.checked = settings.allowedVendors.includes(box.dataset.vendor);
  const n = settings.allowedVendors.length;
  $('vendors-sum').textContent = `Companies you always allow (${n ? n : 'none'})`;

  $('exclude').replaceChildren(...(settings.historyExclude.length ? settings.historyExclude.map(site => {
    const remove = el('button', { text: 'Record again' });
    remove.addEventListener('click', () => save({ historyExclude: settings.historyExclude.filter(s => s !== site) }));
    return el('li', {}, site, remove);
  }) : [el('li', { class: 'none', text: 'None.' })]));

  const entries = Object.entries(settings.sites).sort(([a], [b]) => a.localeCompare(b));
  $('sites').replaceChildren(...(entries.length ? entries.map(([site, mode]) => {
    const select = el('select', { 'aria-label': `Protection for ${site}` },
      el('option', { value: 'on', text: 'Protection on' }), el('option', { value: 'off', text: 'Protection off' }));
    select.value = mode;
    select.addEventListener('change', () => save({ sites: { ...settings.sites, [site]: select.value } }));
    const remove = el('button', { text: 'Use my default' });
    remove.addEventListener('click', () => {
      const sites = { ...settings.sites };
      delete sites[site];
      save({ sites });
    });
    return el('tr', {}, el('td', { class: 'site', text: site }), el('td', {}, select), el('td', {}, remove));
  }) : [el('tr', {}, el('td', { class: 'none', text: 'None yet. Every site uses your default.' }))]));
}

/* ---------- events ---------- */
for (const r of document.querySelectorAll('input[name=protectDefault]')) {
  r.addEventListener('change', () => save({ protectDefault: r.value === 'true' }));
}
for (const box of document.querySelectorAll('input[data-key]')) {
  box.addEventListener('change', () => save({ [box.dataset.key]: box.checked }));
}
for (const sel of document.querySelectorAll('select[data-key]')) {
  sel.addEventListener('change', () => save({ [sel.dataset.key]: sel.dataset.key === 'historyDays' ? Number(sel.value) : sel.value }));
}
for (const box of document.querySelectorAll('input[data-defense]')) {
  box.addEventListener('change', () => save({ defenses: { ...settings.defenses, [box.dataset.defense]: box.checked } }));
}
for (const box of document.querySelectorAll('input[data-vendor]')) {
  box.addEventListener('change', () => {
    const name = box.dataset.vendor;
    save({ allowedVendors: box.checked ? [...settings.allowedVendors, name] : settings.allowedVendors.filter(v => v !== name) });
  });
}

// Accepts "example.com", "www.example.com" or a full URL; returns the site, or null.
function siteFromInput(input) {
  const raw = input.value.trim().toLowerCase();
  let host = raw;
  try { host = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname; } catch { /* keep raw */ }
  const site = siteOf(host);
  if (!site || !/^[a-z0-9.-]+$/.test(site)) { notice('That doesn\'t look like a website address.'); return null; }
  input.value = '';
  return site;
}
$('add').addEventListener('submit', e => {
  e.preventDefault();
  const site = siteFromInput($('add-site'));
  if (site) save({ sites: { ...settings.sites, [site]: $('add-mode').value } }, `Added ${site}.`);
});
$('add-exclude').addEventListener('submit', async e => {
  e.preventDefault();
  const site = siteFromInput($('exclude-site'));
  if (!site) return;
  await forgetSite(site);
  save({ historyExclude: [...new Set([...settings.historyExclude, site])] }, `${site} won't be recorded, and its history is deleted.`);
});
async function forgetSite(site) {
  const { history = {} } = await api.storage.local.get('history');
  for (const host of Object.keys(history)) if (siteOf(host) === site) delete history[host];
  await api.storage.local.set({ history });
}

/* ---------- private windows: does the browser let us run there? ---------- */
const HOW = {
  firefox: 'Open about:addons, click What Sites See, and set "Run in Private Windows" to Allow.',
  chrome: 'Open chrome://extensions, click Details on What Sites See, and turn on "Allow in Incognito".',
  edge: 'Open edge://extensions, click Details on What Sites See, and turn on "Allow in InPrivate".',
  brave: 'Open brave://extensions, click Details on What Sites See, and turn on "Allow in Private".',
  opera: 'Open opera://extensions, find What Sites See, and turn on its private-window option.',
  vivaldi: 'Open vivaldi://extensions, click Details on What Sites See, and turn on its private-window option.',
};
Promise.all([api.extension.isAllowedIncognitoAccess(), detectBrowser()]).then(([allowed, browser]) => {
  const p = $('incognito-access');
  p.className = `access ${allowed ? 'ok' : 'no'}`;
  p.textContent = allowed
    ? 'Your browser lets this extension run in private windows. Private windows are never recorded in history.'
    : `Your browser doesn't let this extension run in private windows yet, so nothing below applies there. ${HOW[browser] ?? HOW.chrome} Browsers don't allow extensions to change this themselves.`;
});

/* ---------- your data ---------- */
$('export').addEventListener('click', async () => {
  const all = await api.storage.local.get(null);
  const data = { exportedAt: new Date().toISOString(), tool: 'What Sites See', version: api.runtime.getManifest().version, ...all };
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'what-sites-see-data.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // Accepts this page's export (settings inside) or a bare settings object.
    const incoming = normalize(data.settings ?? data);
    settings = await saveSettings(api, incoming);
    render();
    notice('Settings imported. History in the file was not imported.');
  } catch {
    notice('That file isn\'t a What Sites See export.');
  }
});
$('clear-history').addEventListener('click', async () => {
  if (!confirm('Delete the record of every site this extension has seen? Your settings stay.')) return;
  await api.storage.local.remove(['history', 'requests']);
  notice('History deleted.');
});
$('erase').addEventListener('click', async () => {
  if (!confirm('Erase all history, deletion requests, your saved name and email, and reset every setting to its default?')) return;
  await api.storage.local.clear();
  await api.storage.local.set({ settings: { ...DEFAULTS } });
  settings = await loadSettings(api);
  render();
  notice('Everything erased. Settings are back to their defaults.');
});

render();

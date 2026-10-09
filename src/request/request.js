import { api } from '../shared/api.js';
import { buildReport } from '../shared/scoring.js';
import { VENDORS } from '../shared/vendors.js';
import { buildLetter, guessLaw, LAWS, asRequest } from '../shared/letters.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const { history = {}, profile = {}, requests = {} } = await api.storage.local.get(['history', 'profile', 'requests']);

/* ---------- which site, and what we know about it ---------- */
// History has the long view (first seen, every technique); a live tab report fills in what
// history doesn't have, e.g. in a private window or with history turned off.
async function siteData(host, tabId) {
  const saved = history[host];
  let live = null;
  if (tabId) {
    const key = 'tab:' + tabId;
    const state = (await api.storage.session.get(key))[key];
    if (state) live = buildReport(state);
  }
  if (!saved && !live) return null;
  const now = Date.now();
  const union = (a = [], b = []) => [...new Set([...a, ...b])];
  return {
    host,
    firstSeen: saved?.firstSeen ?? now,
    lastSeen: saved?.lastSeen ?? now,
    caught: union(saved?.caught, live?.items.map(i => i.id)),
    vendors: union(saved?.vendors, live?.items.flatMap(i => i.scripts.map(s => s.vendor)).filter(Boolean)),
    scripts: union(saved?.scripts, live?.items.flatMap(i => i.scripts.filter(s => s.thirdParty && s.file).map(s => `${s.host}/${s.file}`))).slice(0, 30),
    links: { ...saved?.links, ...Object.fromEntries(Object.entries(live?.links ?? {}).filter(([, v]) => v)) },
  };
}

const host = params.get('host');
if (!host) {
  // No site given: pick one from history.
  const sel = $('site-select');
  const sites = Object.values(history).sort((a, b) => b.maxScore - a.maxScore);
  sel.append(new Option(sites.length ? 'Choose a site…' : 'No sites recorded yet', ''));
  for (const s of sites) sel.append(new Option(`${s.host} (worst score ${s.maxScore})`, s.host));
  sel.addEventListener('change', () => { if (sel.value) location.search = '?host=' + encodeURIComponent(sel.value); });
  $('pick').hidden = false;
} else {
  const site = await siteData(host, Number(params.get('tab')) || null);
  if (!site) {
    $('pick').hidden = false;
    $('pick').querySelector('.lede').textContent = `No record of ${host}. Visit it with the extension running first, or choose a site from your history.`;
  } else {
    setup(site);
  }
}

function setup(site) {
  $('main').hidden = false;
  $('host-title').textContent = site.host;
  document.title = `Deletion Request: ${site.host}`;

  for (const [id, { label }] of Object.entries(LAWS)) $('law').append(new Option(label, id));
  $('law').value = profile.law ?? guessLaw(Intl.DateTimeFormat().resolvedOptions().timeZone);
  $('name').value = profile.name ?? '';
  $('email').value = profile.email ?? '';
  $('state').value = profile.state ?? '';

  let edited = false;
  const generate = () => {
    const law = $('law').value;
    $('state').hidden = law !== 'us-state';
    $('law-note').textContent = {
      ccpa: 'Businesses must respond within 45 days. Your browser\'s Global Privacy Control signal already counts as an opt-out of selling or sharing.',
      'us-state': 'Most US state privacy laws (Colorado, Connecticut, Virginia, Texas, Oregon and others) give you deletion and opt-out rights with a 45-day deadline.',
      gdpr: 'Organizations must respond within one month. If they don\'t, you can complain to your national data protection authority.',
      uk: 'Organizations must respond within one month. If they don\'t, you can complain to the Information Commissioner\'s Office (ICO).',
      other: 'Your local law may not require a response, but many companies honor these requests anyway.',
    }[law];
    if (edited) return;
    const letter = buildLetter(law, site, { name: $('name').value.trim(), email: $('email').value.trim(), state: $('state').value.trim() });
    $('subject').value = letter.subject;
    $('body').value = letter.body;
    updateMailto();
  };
  const saveProfile = () => api.storage.local.set({ profile: { law: $('law').value, name: $('name').value.trim(), email: $('email').value.trim(), state: $('state').value.trim() } });
  for (const id of ['law', 'name', 'email', 'state']) {
    $(id).addEventListener('input', () => { generate(); saveProfile(); });
  }
  for (const id of ['subject', 'body']) {
    $(id).addEventListener('input', () => { edited = true; $('reset').hidden = false; updateMailto(); });
  }
  $('reset').addEventListener('click', () => { edited = false; $('reset').hidden = true; generate(); });

  /* ---------- sending ---------- */
  function updateMailto() {
    const to = $('to').value.trim();
    $('mailto').href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($('subject').value)}&body=${encodeURIComponent($('body').value)}`;
  }
  $('to').addEventListener('input', updateMailto);
  const flash = text => { $('copied').textContent = text; setTimeout(() => { $('copied').textContent = ''; }, 2500); };
  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(`Subject: ${$('subject').value}\n\n${$('body').value}`);
    flash('Copied');
  });
  $('download').addEventListener('click', () => {
    const blob = new Blob([`Subject: ${$('subject').value}\n\n${$('body').value}\n`], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `deletion-request-${site.host}.txt` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Where to send it: the site's own privacy pages, found on the page itself.
  const link = (href, text, tag) => {
    const li = document.createElement('li');
    const a = Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener' });
    li.append(a);
    if (tag) li.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: tag }));
    return li;
  };
  const where = [];
  if (site.links.choices) where.push(link(site.links.choices, `${site.host}'s privacy choices page`, 'opt-out'));
  if (site.links.privacy) where.push(link(site.links.privacy, `${site.host}'s privacy policy`));
  const tip = document.createElement('li');
  tip.textContent = where.length
    ? 'The policy lists a privacy email or web form. If it\'s a form, paste the letter into it.'
    : `Look for "Privacy" or "Your Privacy Choices" at the bottom of ${site.host}. It lists a privacy email or web form; if it's a form, paste the letter into it.`;
  where.push(tip);
  $('where').replaceChildren(...where);

  // The third parties themselves, with verified links where we have them.
  const vendors = site.vendors.map(name => VENDORS.find(v => v.name === name)).filter(Boolean);
  if (vendors.length) {
    $('vendors-step').hidden = false;
    $('vendors').replaceChildren(...vendors.map(v => v.privacy
      ? link(v.privacy, v.name, v.optOut ? 'opt-out form' : null)
      : Object.assign(document.createElement('li'), { textContent: `${v.name}: send the same letter to its privacy team` })));
  }

  // Remember when it was sent and when the law says they must reply, for the History page.
  const day = 86400000;
  const fmt = t => new Date(t).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  const explain = $('sent-when').textContent;
  const markSent = r => {
    $('sent').checked = !!r;
    $('sent-when').textContent = r
      ? `Sent ${fmt(r.sentAt)}. They must reply by ${fmt(r.dueAt)}${Date.now() > r.dueAt ? '. That date has passed: you can file a complaint (California Attorney General, your state AG, or your data protection authority).' : '.'}`
      : explain;
  };
  markSent(asRequest(requests[site.host]));
  $('sent').addEventListener('change', async () => {
    const { requests: current = {} } = await api.storage.local.get('requests');
    if ($('sent').checked) {
      const sentAt = Date.now();
      current[site.host] = { sentAt, dueAt: sentAt + (LAWS[$('law').value]?.days ?? 45) * day, law: $('law').value };
    } else {
      delete current[site.host];
    }
    await api.storage.local.set({ requests: current });
    markSent(asRequest(current[site.host]));
  });

  generate();
}

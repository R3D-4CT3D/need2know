import { api } from '../shared/api.js';
import { GRADES } from '../shared/scoring.js';

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

let s;
try { s = await (await fetch(api.runtime.getURL('data/crawl-stats.json'))).json(); } catch { s = null; }
if (!s) {
  $('lede').textContent = 'No crawl results are bundled with this version.';
} else {
  const date = new Date(s.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  $('title').textContent = `Fingerprinting on the web's top ${s.sites} sites`;
  $('lede').textContent = `This extension visited the homepages of the ${s.sites} most popular websites (Tranco research list) on ${date} and recorded what each one tried, then visited again with protection on.`;

  const active = Math.round(((s.grades.moderate + s.grades.heavy) / s.sites) * 100);
  const tiles = [
    [`${s.median}`, 'median score out of 100'],
    [`${active}%`, 'actively fingerprinted visitors (score 25+)'],
    [`${s.medianThirdParties}`, 'other companies\' domains contacted, median per homepage'],
    [`${s.protection.stoppedShare}%`, `of attempts stopped with protection on (${s.protection.attempts} attempts)`],
  ];
  $('tiles').replaceChildren(...tiles.map(([n, k]) => el('div', { class: 'tile' }, el('div', { class: 'n', text: n }), el('div', { class: 'k', text: k }))));

  // A bar list: the label and value are text in ink; the bar is the only colored mark.
  const bars = (rows, max) => rows.map(({ label, value, display, tip }) => {
    const fill = el('div', { class: 'fill', 'aria-hidden': 'true' });
    fill.style.width = `${max ? (value / max) * 100 : 0}%`;
    return el('li', { title: tip },
      el('span', { class: 'label', text: label }),
      el('div', { class: 'track' }, fill),
      el('span', { class: 'v', text: display }));
  });
  $('techniques').replaceChildren(...bars(s.techniques.map(t => ({
    label: t.title, value: t.share, display: `${t.share}%`,
    tip: `${t.title}: ${t.sites} of ${s.sites} sites (${t.share}%), by a third party on ${t.thirdParty}%`,
  })), 100));
  const gradeRows = ['heavy', 'moderate', 'low', 'none'].map(g => ({
    label: `${GRADES[g].label} (${{ heavy: '60+', moderate: '25–59', low: '1–24', none: '0' }[g]})`,
    value: s.grades[g], display: `${s.grades[g]}`, tip: `${s.grades[g]} of ${s.sites} sites`,
  }));
  $('grades').replaceChildren(...bars(gradeRows, Math.max(...gradeRows.map(r => r.value))));
  $('vendors-block').hidden = !s.vendors.length;
  $('vendors').replaceChildren(...bars(s.vendors.map(v => ({ label: v.name, value: v.share, display: `${v.share}%`, tip: `${v.name}: ${v.sites} of ${s.sites} sites` })), 100));

  $('top').replaceChildren(...s.top.map(t => el('tr', {},
    el('td', { text: t.domain }), el('td', { class: 'n', text: `#${t.rank}` }), el('td', { class: 'n', text: t.score }), el('td', { class: 'n', text: t.techniques }))));

  const broke = s.protection.possibleBreakage;
  $('protection').textContent = `${s.protection.stoppedShare}% of the fingerprinting attempts protection is designed for were stopped. ${broke.length ? `${broke.length} site${broke.length === 1 ? '' : 's'} showed possible breakage:` : 'No site showed signs of breaking.'}`;
  $('breakage').replaceChildren(...broke.map(b => el('li', {}, el('b', { text: b.domain }), `: ${b.reasons.join('; ')}`)));
  const challenges = s.protection.botChallenges ?? [];
  $('challenges').hidden = !challenges.length;
  $('challenges').textContent = `${challenges.length} site${challenges.length === 1 ? '' : 's'} showed a bot-check page instead during the protected visit. Follow-up visits got the same page with protection off, so the crawler had been flagged for repeated automated visits; that isn't counted as breakage.`;
  $('challenge-list').replaceChildren(...challenges.map(c => el('li', {}, el('b', { text: c.domain }), `: ${c.note}`)));
  const under = s.protection.notDetectedAsBlocked ?? [];
  $('undercount').hidden = !under.length;
  $('undercount').textContent = `The ${s.protection.stoppedShare}% is a lower bound: on ${under.map(u => u.domain).join(', ')}, a session recorder was blocked but reported as not blocked, because it loads with fetch, which the version used for the crawl didn't track. That's fixed now.`;

  $('method').replaceChildren(...[
    `Sites: the first ${s.sites} domains of Tranco list ${s.tranco} that serve a web page.`,
    'Each homepage: wait for it to load, scroll to the bottom like a reader, wait again, read the extension\'s report. Then the same with protection on.',
    'Homepages only, from one location, one visit each. Logins, checkouts and articles often fingerprint more.',
    'The crawler presents a normal Chrome user agent, as is standard in web measurement research.',
  ].map(t => el('li', { text: t })));
}

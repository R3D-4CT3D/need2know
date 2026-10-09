import { api } from '../shared/api.js';
import { loadSettings, saveSettings } from '../shared/settings.js';
import { detectBrowser, BROWSERS, HARDEN } from '../shared/guides.js';

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

const browser = await detectBrowser();
let settings = await loadSettings(api);
let { checkup: ticked = {} } = await api.storage.local.get('checkup');

// Each check reads settings and can turn itself on in one click.
const EXTENSION_CHECKS = [
  { title: 'Protection on by default', why: 'Every site gets protection unless you turn it off for that site. Off by default, so you choose.',
    on: s => s.protectDefault, patch: () => ({ protectDefault: true }) },
  { title: 'All defenses enabled', why: 'Canvas and audio noise, generic GPU, CPU and memory, fewer device details.',
    on: s => Object.values(s.defenses).every(Boolean), patch: s => ({ defenses: Object.fromEntries(Object.keys(s.defenses).map(k => [k, true])) }) },
  { title: 'Session recorders blocked', why: 'Stops scripts that can replay your typing and clicks, where protection is on.',
    on: s => s.blockReplay, patch: () => ({ blockReplay: true }) },
  { title: 'Fingerprinting services blocked', why: 'Stops companies whose product is identifying your device, where protection is on.',
    on: s => s.blockFingerprinters, patch: () => ({ blockFingerprinters: true }) },
  { title: 'Global Privacy Control on', why: 'A legal "do not sell or share" signal in California, Colorado, Connecticut and other states.',
    on: s => s.gpc, patch: () => ({ gpc: true }) },
  { title: 'WebRTC IP leak protection', why: 'Stops pages discovering your real IP behind a VPN.',
    on: s => s.webrtc, patch: () => ({ webrtc: true }) },
];

function render() {
  const extOn = EXTENSION_CHECKS.map(c => !!c.on(settings));
  $('ext-checks').replaceChildren(...EXTENSION_CHECKS.map((c, i) => {
    const button = extOn[i] ? null : el('button', { text: 'Turn on' });
    button?.addEventListener('click', () => update(c.patch(settings)));
    return el('li', {},
      el('span', { class: `mark ${extOn[i] ? 'on' : 'off'}`, text: extOn[i] ? '✓' : '✗', 'aria-label': extOn[i] ? 'On' : 'Off' }),
      el('div', {}, el('b', { text: c.title }), el('span', { class: 'why', text: c.why })),
      button);
  }));

  const steps = HARDEN[browser] ?? HARDEN.chrome;
  $('browser-name').textContent = BROWSERS[browser];
  $('browser-checks').replaceChildren(...steps.map(step => {
    const box = el('input', { type: 'checkbox', 'aria-label': 'Done' });
    box.checked = !!ticked[`${browser}:${step.id}`];
    box.addEventListener('change', async () => {
      ticked = { ...ticked, [`${browser}:${step.id}`]: box.checked };
      await api.storage.local.set({ checkup: ticked });
      render();
    });
    return el('li', {}, box, el('div', {}, el('b', { text: step.text })), null);
  }));

  const done = extOn.filter(Boolean).length + steps.filter(s => ticked[`${browser}:${s.id}`]).length;
  const total = EXTENSION_CHECKS.length + steps.length;
  const ratio = done / total;
  document.body.style.setProperty('--grade', `var(${ratio >= 0.8 ? '--ok' : ratio >= 0.5 ? '--warn' : '--stamp'})`);
  $('score-n').textContent = done;
  $('score-of').textContent = total;
  $('score-fill').style.width = `${Math.round(ratio * 100)}%`;
  $('score-label').textContent = ratio === 1 ? 'Every defense is in place' : `defenses in place. ${total - done} more to go.`;
}

async function update(patch) {
  settings = await saveSettings(api, patch);
  render();
}

render();

/* ---------- side-by-side measurement ---------- */
// Three hidden frames run the same probe: plain, and protected under two different site seeds.
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
const frames = { raw: 'probe.html?id=raw', a: `probe-protected.html?id=a&seed=${seed()}`, b: `probe-protected.html?id=b&seed=${seed()}` };
const results = {};
addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'probe' || !(e.data.id in frames)) return;
  results[e.data.id] = e.data.data;
  if (Object.keys(results).length === 3) compare();
});
$('probes').append(...Object.values(frames).map(src => el('iframe', { src, title: 'measurement', tabindex: '-1' })));

const ROWS = [
  ['canvas', 'Canvas fingerprint', 'perSite'],
  ['audio', 'Audio fingerprint', 'perSite'],
  ['gpu', 'Graphics chip', 'generic'],
  ['cores', 'CPU cores', 'generic'],
  ['memory', 'Memory (GB)', 'generic'],
  ['voices', 'Speech voices', 'generic'],
  ['keyboard', 'Keyboard layout', 'generic'],
  ['hints', 'Exact OS version and device model', 'generic'],
  ['fonts', 'Installed fonts found', 'generic'],
  ['screen', 'Screen size', 'visible'],
  ['timezone', 'Time zone', 'visible'],
  ['language', 'Languages', 'visible'],
];

function compare() {
  const { raw, a, b } = results;
  $('compare').replaceChildren(...ROWS.map(([k, label, kind]) => {
    const show = v => v == null || v === '' ? 'n/a' : String(v);
    const changed = show(a[k]) !== show(raw[k]);
    let result;
    if (kind === 'perSite' && changed && show(a[k]) !== show(b[k])) result = ['Changes per site ✓', 'ok'];
    else if (kind === 'generic' && (changed || show(raw[k]) === 'n/a')) result = [show(raw[k]) === 'n/a' ? 'Not exposed ✓' : 'Generalized ✓', 'ok'];
    else if (kind === 'generic') result = ['Already common', 'meh'];
    else result = ['Visible to every site', kind === 'visible' ? 'meh' : 'no'];
    return el('tr', {},
      el('td', { text: label }),
      el('td', { class: 'v', text: show(raw[k]) }),
      el('td', { class: `v${changed ? ' changed' : ''}`, text: show(a[k]) }),
      el('td', { class: `v${show(b[k]) !== show(raw[k]) ? ' changed' : ''}`, text: show(b[k]) }),
      el('td', { class: `res ${result[1]}`, text: result[0] }));
  }));
}

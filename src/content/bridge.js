// Runs in the extension's isolated world. It collects tallies from hooks.js, adds the domains
// this frame contacted (and any that failed to load, which is how blocked vendors show up),
// and sends one cumulative snapshot to the background. Sending the whole snapshot (not deltas)
// means a restarted background or a lost message heals itself.
// It also hands protection (content/protect/core.js) its per-site noise seed.
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const CHANNEL = 'wss:report';
  const SEND_MS = 500;
  const MAX_SCRIPTS = 50;
  const MAX_HOSTS = 300;
  const isTop = window === window.top;
  // Identifies this document so the background can drop late messages from a previous page.
  const doc = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const snap = {}; // tech -> { n, x, s: { scriptUrl: count } }
  const hosts = new Set();
  const failed = new Set();
  let protect = false;
  let links = {};
  let timer = 0;
  let live = !document.prerendering; // a prerendered page isn't the one the user is looking at yet

  function post(msg) {
    try { return api.runtime.sendMessage(msg)?.catch?.(() => null); } catch { return null; }
  }

  /* ---------- seed handoff to protect/core.js ---------- */
  // core.js invents a private event name and announces it on "wss:hello". We cancel the
  // event to confirm receipt, then deliver the seed under that name once the background replies.
  // Only this isolated world can tell a private window apart (extension.inIncognitoContext),
  // so it answers immediately whether private-window-only protection should switch on.
  let greeted = false;
  document.addEventListener('wss:hello', e => {
    if (greeted || typeof e.detail !== 'string') return;
    let hello;
    try { hello = JSON.parse(e.detail); } catch { return; }
    if (typeof hello?.channel !== 'string') return;
    greeted = true;
    e.preventDefault();
    const active = !hello.privateOnly || api.extension?.inIncognitoContext === true;
    document.dispatchEvent(new CustomEvent(hello.channel, { detail: JSON.stringify({ active }) }));
    if (!active) return;
    protect = true;
    Promise.resolve(post({ type: 'seed' })).then(seed => {
      if (typeof seed === 'number') document.dispatchEvent(new CustomEvent(hello.channel, { detail: String(seed) }));
    });
    schedule();
  });
  // hooks.js asks, privately, whether this page's CSP allows blob: workers (Web Worker coverage).
  let hooksGreeted = false;
  document.addEventListener('wss:hooks-hello', e => {
    if (hooksGreeted || typeof e.detail !== 'string') return;
    let hello;
    try { hello = JSON.parse(e.detail); } catch { return; }
    if (typeof hello?.channel !== 'string') return;
    hooksGreeted = true;
    e.preventDefault();
    Promise.resolve(post({ type: 'frame-info' })).then(info => {
      if (typeof info?.blobWorkers === 'boolean') {
        document.dispatchEvent(new CustomEvent(hello.channel, { detail: JSON.stringify({ blobWorkers: info.blobWorkers }) }));
      }
    });
  });
  document.dispatchEvent(new CustomEvent('wss:bridge-ready'));

  /* ---------- tallies from hooks.js ---------- */
  document.addEventListener(CHANNEL, e => {
    let batch;
    try { batch = JSON.parse(e.detail); } catch { return; }
    if (!Array.isArray(batch)) return;
    for (const [t, s, n, x] of batch) {
      if (typeof t !== 'string' || typeof n !== 'number') continue;
      const row = snap[t] ??= { n: 0, x: null, s: {} };
      row.n += n;
      if (typeof x === 'number') row.x = Math.max(row.x ?? 0, x);
      if (typeof s === 'string' && (s in row.s || Object.keys(row.s).length < MAX_SCRIPTS)) {
        row.s[s] = (row.s[s] || 0) + n;
      }
    }
    schedule();
  });

  /* ---------- domains contacted, and loads that failed ---------- */
  const hostOf = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname : null; } catch { return null; } };
  function addHost(set, host) {
    if (!host || set.has(host) || set.size >= MAX_HOSTS) return false;
    set.add(host);
    return true;
  }
  try {
    new PerformanceObserver(list => {
      let added = false;
      for (const entry of list.getEntries()) added = addHost(hosts, hostOf(entry.name)) || added;
      if (added) schedule();
    }).observe({ type: 'resource', buffered: true });
  } catch { /* very old browser */ }
  // A blocked script or image fires "error" on its element. These don't bubble, but they do
  // pass through window in the capture phase.
  addEventListener('error', e => {
    const t = e.target;
    if (!t || t === window) return;
    if (addHost(failed, hostOf(t.src || t.href))) schedule();
  }, true);

  /* ---------- the site's privacy pages, for deletion requests ---------- */
  function findLinks() {
    const found = {};
    for (const a of document.querySelectorAll('a[href]')) {
      const text = (a.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!/^https?:/.test(a.href)) continue;
      if (!found.choices && /privacy choices|do not sell|do not share|opt[- ]out/.test(text)) found.choices = a.href;
      if (!found.privacy && (/privacy (policy|notice|statement|center)|^privacy$/.test(text) || /\/privacy([-_/.]|$)/i.test(a.pathname))) found.privacy = a.href;
    }
    if (found.privacy !== links.privacy || found.choices !== links.choices) { links = found; schedule(); }
  }
  if (isTop) {
    document.addEventListener('DOMContentLoaded', findLinks);
    addEventListener('load', () => setTimeout(findLinks, 1000)); // footers often render late
  }

  /* ---------- "this page may record your typing" warning ---------- */
  // The background tells us when an unblocked session recorder is running on this page.
  // The notice appears once, under the first text field you focus. It lives in a closed
  // shadow root, so page styles and scripts can't restyle, read or fake it.
  let recorders = null;
  let warned = false;
  api.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'recorder' && Array.isArray(msg.vendors)) recorders = msg.vendors.map(String);
  });
  const TEXT_TYPES = /^(|text|email|password|search|tel|url|number)$/;
  const isTextField = t => t instanceof HTMLTextAreaElement || t?.isContentEditable ||
    (t instanceof HTMLInputElement && TEXT_TYPES.test(t.type));
  document.addEventListener('focusin', e => {
    if (!recorders || warned || !isTextField(e.target)) return;
    warned = true;
    showWarning(e.target);
  }, true);

  function showWarning(field) {
    const r = field.getBoundingClientRect();
    const host = document.createElement('div');
    host.style.cssText = `all:initial;position:absolute;z-index:2147483647;left:${Math.max(8, r.left + scrollX)}px;top:${r.bottom + scrollY + 6}px`;
    const root = host.attachShadow({ mode: 'closed' });
    const names = recorders.length > 1 ? `${recorders.slice(0, -1).join(', ')} and ${recorders.at(-1)}` : recorders[0];
    root.innerHTML = `<style>
      .box{font:13px/1.45 system-ui,sans-serif;color:#1a201c;background:#fff8e6;border:1.5px solid #b8392a;border-radius:6px;
        padding:10px 12px;max-width:340px;box-shadow:0 4px 16px rgba(0,0,0,.18)}
      b{display:block;color:#b8392a;margin-bottom:2px} p{margin:0 0 8px}
      button{font:700 12px system-ui,sans-serif;border-radius:4px;padding:4px 10px;cursor:pointer;margin-right:6px}
      .go{background:#b8392a;color:#fff;border:0} .no{background:none;border:1px solid #888;color:#1a201c}
    </style><div class="box" role="alert"><b>This page may record what you type</b><p></p>
      <button class="go">Block recorders and reload</button><button class="no">Dismiss</button></div>`;
    root.querySelector('p').textContent = `It loads ${names}, which can replay your keystrokes, clicks and scrolling. Recorders usually hide passwords and card numbers, but not always other fields. (What Sites See)`;
    root.querySelector('.go').addEventListener('click', () => { post({ type: 'block-recorders' }); host.remove(); });
    root.querySelector('.no').addEventListener('click', () => host.remove());
    document.documentElement.append(host);
  }

  /* ---------- sending ---------- */
  function schedule() {
    if (!timer) timer = setTimeout(send, SEND_MS);
  }
  function send() {
    timer = 0;
    if (live) post({ type: 'snap', doc, url: location.href, snap, hosts: [...hosts], failed: [...failed], protect, links });
  }
  function announce() {
    if (isTop) post({ type: 'page', doc, url: location.href });
    send();
  }

  if (live) announce();
  else document.addEventListener('prerenderingchange', () => { live = true; announce(); }, { once: true });
  // Back/forward cache: the page comes back to life without reloading, so re-announce it.
  addEventListener('pageshow', e => { if (e.persisted) announce(); });
})();

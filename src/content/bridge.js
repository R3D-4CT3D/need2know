// Runs in the extension's isolated world. It collects tallies from hooks.js, adds the domains
// this frame has contacted, and sends one cumulative snapshot to the background. Sending the
// whole snapshot (not deltas) means a restarted background or a lost message heals itself.
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
  let timer = 0;
  let live = !document.prerendering; // a prerendered page isn't the one the user is looking at yet

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

  function seeResources(entries) {
    let added = false;
    for (const entry of entries) {
      if (hosts.size >= MAX_HOSTS) break;
      try {
        const u = new URL(entry.name);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && !hosts.has(u.hostname)) {
          hosts.add(u.hostname);
          added = true;
        }
      } catch { /* not a URL */ }
    }
    if (added) schedule();
  }
  try {
    new PerformanceObserver(list => seeResources(list.getEntries())).observe({ type: 'resource', buffered: true });
  } catch { /* very old browser */ }

  function post(msg) {
    try { api.runtime.sendMessage(msg)?.catch?.(() => {}); } catch { /* extension reloaded */ }
  }
  function schedule() {
    if (!timer) timer = setTimeout(send, SEND_MS);
  }
  function send() {
    timer = 0;
    if (live) post({ type: 'snap', doc, url: location.href, snap, hosts: [...hosts] });
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

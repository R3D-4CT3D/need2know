// Protection, part 1 of 3: shared machinery. Runs in the page's own world at document_start,
// before the defense files and hooks.js. Each defense lives in its own file so only the ones the
// user enabled are injected (see shared/plan.js). This file hands its helpers to them through a
// temporary property on window; seal.js deletes it before any page script runs, so pages never
// see it.
//
// Two strategies, both used by Brave and Firefox:
//   noise    canvas, WebGL pixels and audio get tiny changes, seeded per site and per browser
//            session. One site always sees the same "you"; two sites see different ones, so
//            they can't link your visits.
//   generic  GPU name, CPU cores, memory and device details are replaced with common values
//            many people share, so they stop narrowing you down.
// Every override computes the real answer first and falls back to it if anything goes wrong.
(() => {
  'use strict';

  const W = window;
  const { apply } = Reflect;
  const getDesc = Object.getOwnPropertyDescriptor;
  const defineProp = Object.defineProperty;
  const ProxyCtor = Proxy;
  const EventCtor = CustomEvent;
  const listen = EventTarget.prototype.addEventListener;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const detailOf = getDesc(CustomEvent.prototype, 'detail').get;
  const random32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const doc = document;
  const P = name => W[name] && W[name].prototype;

  /* ---------- the per-site seed ---------- */
  // The seed comes from the background (secret, per site, per session). The bridge fetches it
  // asynchronously and delivers it on an event name invented here. That name is handed to the
  // bridge before any page script exists, so the page can't overhear it. If a site reads
  // before the seed arrives, a random seed is locked in for the whole page instead, so
  // protection never fails open.
  const channel = 'wss:' + random32().toString(36) + random32().toString(36);
  let seed = null;
  let active = null;
  const seedNow = () => (active ??= (seed ?? random32()));
  apply(listen, doc, [channel, e => {
    const s = Number(apply(detailOf, e, []));
    if (seed === null && Number.isFinite(s)) seed = s >>> 0;
  }]);
  // Whichever of core.js and bridge.js runs second triggers the handoff. The bridge cancels
  // the event to confirm receipt, after which the name is never sent again.
  let delivered = false;
  const hello = () => {
    if (!delivered) delivered = !apply(dispatch, doc, [new EventCtor('wss:hello', { detail: channel, cancelable: true })]);
  };
  apply(listen, doc, ['wss:bridge-ready', hello]);
  hello();
  // The Checkup page demonstrates protection inside the extension's own pages, where there's
  // no bridge. It passes a demo seed in the URL. Websites can never reach this branch.
  if (/^(chrome|moz)-extension:$/.test(location.protocol)) {
    const s = Number(new URLSearchParams(location.search).get('seed'));
    if (s) seed = s >>> 0;
  }

  // 32-bit integer hash (a "murmur3 finalizer"): fast, and well mixed enough that the noise
  // looks random.
  const mix = h => {
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16; return h >>> 0;
  };

  /* ---------- wrapping ---------- */
  function override(proto, name, fn) { // fn(native, self, args)
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.value !== 'function') return;
    d.value = new ProxyCtor(d.value, { apply: (native, self, args) => fn(native, self, args) });
    defineProp(proto, name, d);
  }
  function overrideGetter(proto, name, fn) { // fn(realValue) -> value to return
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.get !== 'function') return;
    d.get = new ProxyCtor(d.get, {
      apply(native, self, args) {
        const real = apply(native, self, args);
        try { return fn(real); } catch (_) { return real; }
      },
    });
    defineProp(proto, name, d);
  }
  // For methods returning a value (or a promise of one) that we adjust after the fact.
  function adjust(proto, name, fn) {
    override(proto, name, (native, self, args) => {
      const real = apply(native, self, args);
      try { return fn(real, args, self); } catch (_) { return real; }
    });
  }

  Object.defineProperty(W, '__wssProtect', {
    configurable: true,
    value: { W, P, apply, doc, seedNow, mix, override, overrideGetter, adjust },
  });
})();

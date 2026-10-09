// Runs first inside a page's Web Worker. hooks.js starts each worker from a small blob: script:
//   (this function)(config); importScripts(originalUrl)
// or, for module workers:
//   const ready = (this function)(config); try { await import(originalUrl) } finally { ready() }
// The build inlines this file into hooks.js as a string, so it has no access to anything else:
// everything it needs is in here or in `cfg`.
//   cfg.url      the worker script the page asked for
//   cfg.protect  null, or { seed, defenses: [...], fonts: [standard font names] } when the page
//                is protected, so the worker gives the same answers as the page
// Results go back to hooks.js on a private MessagePort sent as the worker's first message.
(function wssWorkerPrelude(cfg) {
  'use strict';

  const G = self;
  const { apply, construct } = Reflect;
  const getDesc = Object.getOwnPropertyDescriptor;
  const defineProp = Object.defineProperty;
  const ProxyCtor = Proxy;
  const URLCtor = URL;
  const P = name => G[name] && G[name].prototype;
  const blobUrl = String(G.location.href); // this blob: script, before location is replaced

  /* ---------- 1. Keep relative URLs working ---------- */
  // The worker now runs from a blob: URL, which would break anything resolved relative to the
  // worker's own location. Resolve those against the original script, as the browser would have.
  const base = cfg.url;
  const resolve = u => {
    if (typeof u !== 'string' && !(u instanceof URLCtor)) return u;
    const s = String(u);
    return /^[a-z][\w+.-]*:/i.test(s) ? s : new URLCtor(s, base).href;
  };
  const real = new URLCtor(base);
  const location = {};
  for (const k of ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash']) location[k] = real[k];
  location.toString = () => real.href;
  defineProp(G, 'location', { configurable: true, enumerable: true, get: () => location });
  // Globals like fetch and importScripts live on the global's prototype chain, not on self.
  const ownerOf = (obj, name) => { for (let o = obj; o; o = Object.getPrototypeOf(o)) if (getDesc(o, name)) return o; return null; };
  const wrapFn = (target, name, mapArgs) => {
    const owner = ownerOf(target, name);
    const d = owner && getDesc(owner, name);
    if (!d || typeof d.value !== 'function') return;
    d.value = new ProxyCtor(d.value, { apply: (t, self, args) => apply(t, self, mapArgs(args)) });
    defineProp(owner, name, d);
  };
  const wrapCtor = (name, mapArgs) => {
    const owner = ownerOf(G, name);
    const d = owner && getDesc(owner, name);
    if (!d || typeof d.value !== 'function') return;
    d.value = new ProxyCtor(d.value, { construct: (t, args, nt) => construct(t, mapArgs(args), nt) });
    defineProp(owner, name, d);
  };
  const first = args => (args.length ? [resolve(args[0]), ...args.slice(1)] : args);
  wrapFn(G, 'importScripts', args => args.map(resolve));
  wrapFn(G, 'fetch', first);
  wrapFn(P('XMLHttpRequest'), 'open', args => [args[0], resolve(args[1]), ...args.slice(2)]);
  wrapCtor('Request', first);
  wrapCtor('EventSource', first);
  wrapCtor('Worker', first);

  /* ---------- 2. Reporting ---------- */
  // Workers are often terminated the moment they answer, which would kill a pending timer.
  // So reports go out right after the current task, as a microtask, not on a delay.
  const tally = new Map();
  let port = null;
  let queued = false;
  const flush = () => {
    queued = false;
    if (!port || !tally.size) return;
    port.postMessage([...tally.values()]);
    tally.clear();
  };
  // The extension's first message carries the port. Stopping it here means the worker's own
  // message handlers never see it.
  // Module workers load the original script with an await, during which the browser may
  // already deliver the page's messages, before the worker's own handlers exist. Hold them
  // until the module has loaded, then deliver them again in order.
  let holding = cfg.module === true;
  const held = [];
  G.addEventListener('message', e => {
    if (!port && e.data && e.data.__wss === true && e.ports[0]) {
      e.stopImmediatePropagation();
      port = e.ports[0];
      flush();
    } else if (holding) {
      e.stopImmediatePropagation();
      held.push(e);
    }
  });
  const ready = () => {
    holding = false;
    for (const e of held.splice(0)) {
      G.dispatchEvent(new MessageEvent('message', { data: e.data, ports: [...e.ports], origin: e.origin, lastEventId: e.lastEventId }));
    }
  };
  const URL_RE = /((?:blob:)?(?:https?|file):\/\/[^\s()@]+?):\d+:\d+/g;
  const lastCaller = new Map();
  function caller(tech) {
    const stack = String(new Error().stack || '');
    for (const m of stack.matchAll(URL_RE)) {
      if (m[1].startsWith(blobUrl)) continue; // our own prelude
      const src = m[1].replace(/[?#].*$/, '');
      lastCaller.set(tech, src);
      return src;
    }
    return lastCaller.get(tech) || null;
  }
  function hit(tech, extra) {
    const src = caller(tech);
    const key = tech + '\u0000' + (src || '');
    const row = tally.get(key);
    if (row) { row[2]++; if (extra !== undefined) row[3] = extra; } else tally.set(key, [tech, src, 1, extra]);
    if (!queued) { queued = true; queueMicrotask(flush); }
  }

  /* ---------- 3. Protection, the same as the page gets ---------- */
  // Must match content/protect/*.js exactly: the same seed and algorithms give the same
  // answers in the worker as on the page, so comparing them reveals nothing.
  const pr = cfg.protect;
  const has = d => !!pr && pr.defenses.includes(d);
  const mix = h => {
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16; return h >>> 0;
  };
  function perturbPixels(data, sx, sy, w) {
    const s = pr.seed >>> 0;
    for (let i = 0, n = data.length; i < n; i += 4) {
      if (data[i + 3] !== 255) continue;
      const p = i >> 2;
      const x = sx + p % w, y = sy + ((p / w) | 0);
      const color = (data[i] & 0xfe) << 16 | (data[i + 1] & 0xfe) << 8 | (data[i + 2] & 0xfe);
      const h = mix(s ^ mix(Math.imul(x, 0x9e3779b1) ^ mix(y ^ color)));
      if ((h & 0xff) < 26) {
        const c = i + ((h >>> 8) % 3);
        data[c] = (data[c] & 0xfe) | ((h >>> 16) & 1);
      }
    }
  }
  const adjust = (proto, name, fn) => {
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.value !== 'function') return;
    d.value = new ProxyCtor(d.value, {
      apply(t, self, args) { const r = apply(t, self, args); try { return fn(r, args, self); } catch (_) { return r; } },
    });
    defineProp(proto, name, d);
  };
  const adjustGetter = (proto, name, fn) => {
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.get !== 'function') return;
    d.get = new ProxyCtor(d.get, { apply(t, self, args) { const r = apply(t, self, args); try { return fn(r); } catch (_) { return r; } } });
    defineProp(proto, name, d);
  };

  const OC = G.OffscreenCanvas;
  const OC2D = P('OffscreenCanvasRenderingContext2D');
  if (has('canvas') && OC && OC2D) {
    const n = { drawImage: OC2D.drawImage, getImageData: OC2D.getImageData, putImageData: OC2D.putImageData, getContext: OC.prototype.getContext };
    const convert = OC.prototype.convertToBlob;
    defineProp(OC.prototype, 'convertToBlob', { ...getDesc(OC.prototype, 'convertToBlob'), value: new ProxyCtor(convert, {
      apply(t, self, args) {
        let target = self;
        try {
          const w = self.width, h = self.height;
          if (w && h && w * h <= 4e6) {
            const copy = new OC(w, h), ctx = apply(n.getContext, copy, ['2d']);
            apply(n.drawImage, ctx, [self, 0, 0]);
            const img = apply(n.getImageData, ctx, [0, 0, w, h]);
            perturbPixels(img.data, 0, 0, w);
            apply(n.putImageData, ctx, [img, 0, 0]);
            target = copy;
          }
        } catch (_) { /* fall back to the real canvas */ }
        return apply(t, target, args);
      },
    }) });
    adjust(OC2D, 'getImageData', (img, args) => { perturbPixels(img.data, args[0] | 0, args[1] | 0, img.width); return img; });
  }
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    if (has('canvas')) adjust(P(name), 'readPixels', (ret, args) => {
      const [x, y, w, , format, type, pixels] = args;
      if (format === 0x1908 && type === 0x1401 && pixels && pixels.BYTES_PER_ELEMENT === 1) perturbPixels(pixels, x | 0, y | 0, w | 0 || 1);
      return ret;
    });
    if (has('gpu')) {
      const BUCKETS = [['NVIDIA', /nvidia|geforce|quadro|rtx|gtx/i], ['AMD', /\bamd\b|radeon|\bati\b/i], ['Intel', /intel/i],
        ['Apple', /apple/i], ['Qualcomm', /qualcomm|adreno/i], ['ARM', /\bmali\b|\barm\b/i], ['Google', /swiftshader|google/i]];
      const bucket = s => (BUCKETS.find(([, re]) => re.test(s)) || ['Generic'])[0];
      const renderer = r => { const s = String(r), b = bucket(s); const a = s.match(/^ANGLE \(.*,\s*([^,]*)\)$/); return a ? `ANGLE (${b}, ${b} Graphics, ${a[1]})` : `${b} Graphics`; };
      const vendor = v => /^Google Inc\. \(/.test(String(v)) ? `Google Inc. (${bucket(String(v).slice(12))})` : bucket(String(v));
      adjust(P(name), 'getParameter', (v, [p]) => {
        if (p === 0x9246 || (p === 0x1F01 && typeof v === 'string' && !/^WebKit/.test(v))) return renderer(v);
        if (p === 0x9245) return vendor(v);
        return v;
      });
    }
  }
  if (has('hardware')) {
    adjustGetter(P('WorkerNavigator'), 'hardwareConcurrency', v => typeof v === 'number' ? (v <= 4 ? 4 : 8) : v);
    adjustGetter(P('WorkerNavigator'), 'deviceMemory', v => typeof v === 'number' ? (v >= 4 ? 8 : 4) : v);
  }
  if (has('device')) {
    adjust(P('NavigatorUAData'), 'getHighEntropyValues', p => p.then(v => {
      const major = s => String(s).split('.')[0] + '.0.0.0';
      if ('model' in v) v.model = '';
      if (v.platformVersion) v.platformVersion = String(v.platformVersion).split('.')[0] + '.0.0';
      if (v.uaFullVersion) v.uaFullVersion = major(v.uaFullVersion);
      if (Array.isArray(v.fullVersionList)) v.fullVersionList = v.fullVersionList.map(b => ({ brand: b.brand, version: major(b.version) }));
      return v;
    }));
  }
  if (has('fonts') && OC2D && Array.isArray(pr.fonts)) {
    const standard = new Set(pr.fonts);
    const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|emoji|math|fangsong)$/;
    const fontDesc = getDesc(OC2D, 'font');
    const measure = OC2D.measureText;
    defineProp(OC2D, 'measureText', { ...getDesc(OC2D, 'measureText'), value: new ProxyCtor(measure, {
      apply(t, self, args) {
        const font = apply(fontDesc.get, self, []);
        const m = /^(.*?\d[\d.]*(?:px|pt|em|rem|%|ex|ch|vw|vh)(?:\s*\/\s*\S+)?\s+)(.+)$/.exec(font);
        if (!m) return apply(t, self, args);
        const families = m[2].split(',').map(f => f.trim());
        const kept = families.filter(f => { const b = f.replace(/^["']|["']$/g, '').toLowerCase(); return GENERIC.test(b) || standard.has(b); });
        if (kept.length === families.length) return apply(t, self, args);
        apply(fontDesc.set, self, [m[1] + (kept.join(', ') || 'sans-serif')]);
        try { return apply(t, self, args); } finally { apply(fontDesc.set, self, [font]); }
      },
    }) });
  }

  /* ---------- 4. Detection (wraps the protection above, like hooks.js on the page) ---------- */
  const spy = (proto, name, fn) => {
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.value !== 'function') return;
    d.value = new ProxyCtor(d.value, { apply(t, self, args) { try { fn(self, args); } catch (_) { /* never break */ } return apply(t, self, args); } });
    defineProp(proto, name, d);
  };
  const spyGetter = (proto, name, fn) => {
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.get !== 'function') return;
    d.get = new ProxyCtor(d.get, { apply(t, self, args) { try { fn(); } catch (_) { /* never break */ } return apply(t, self, args); } });
    defineProp(proto, name, d);
  };
  const texted = new WeakSet();
  const readback = canvas => { if (canvas && canvas.width >= 16 && canvas.height >= 16) hit(texted.has(canvas) ? 'canvas-fp' : 'canvas-read'); };
  const fonts = new Set();
  if (OC2D) {
    spy(OC2D, 'fillText', ctx => texted.add(ctx.canvas));
    spy(OC2D, 'strokeText', ctx => texted.add(ctx.canvas));
    spy(OC2D, 'getImageData', ctx => readback(ctx.canvas));
    spy(OC2D, 'measureText', ctx => { const f = ctx.font; if (!fonts.has(f) && fonts.size < 1000) { fonts.add(f); hit('font-probe', fonts.size); } });
  }
  if (OC) spy(OC.prototype, 'convertToBlob', readback);
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    spy(P(name), 'getParameter', (_, [p]) => { if (p === 0x9245 || p === 0x9246) hit('webgl-gpu'); });
  }
  const props = new Set();
  for (const k of ['hardwareConcurrency', 'deviceMemory', 'platform', 'languages', 'userAgent', 'connection']) {
    spyGetter(P('WorkerNavigator'), k, () => { if (!props.has(k)) { props.add(k); hit('hw-sweep', props.size); } });
  }
  spy(P('NavigatorUAData'), 'getHighEntropyValues', () => hit('client-hints'));
  spy(P('StorageManager'), 'estimate', () => hit('storage-estimate'));

  return ready;
})

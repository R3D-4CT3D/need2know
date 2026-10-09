// Runs in the page's own JavaScript world ("MAIN") at document_start, before any page script.
// It wraps the browser APIs that fingerprinters rely on, notes which script called them, and
// hands tallies to bridge.js. It never changes what an API returns, so sites behave normally.
// It also extends the same watching (and, on protected pages, protection) into Web Workers.
(() => {
  'use strict';

  // Protection files, when present, ran just before this one and left their shared helpers on
  // window. Take what workers need, then remove it before any page script can see it.
  const protection = window.__wssProtect || null;
  delete window.__wssProtect;

  const CHANNEL = 'wss:report';
  const FLUSH_MS = 300;
  const STACK_BUDGET = 40; // stack traces captured per technique, after that we reuse the last caller

  // Private references taken before any page code runs, so later tampering can't blind us.
  const W = window;
  const { apply } = Reflect;
  const getDesc = Object.getOwnPropertyDescriptor;
  const defineProp = Object.defineProperty;
  const ProxyCtor = Proxy;
  const ErrorCtor = Error;
  const EventCtor = CustomEvent;
  const stringify = JSON.stringify;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const listen = EventTarget.prototype.addEventListener;
  const exec = RegExp.prototype.exec;

  // Report through the highest same-origin ancestor. Fingerprinters (FingerprintJS included)
  // create an iframe, probe inside it, and delete it within milliseconds, which kills any timer
  // still pending inside it. The ancestor's document and timers outlive the iframe.
  // Climbing stops at the first cross-origin parent, because reading its .document throws.
  let host = W;
  try { while (host !== host.parent && host.parent.document) host = host.parent; } catch (_) { /* cross-origin */ }
  const doc = host.document;
  const later = host.setTimeout.bind(host);

  /* ---------- who called? ---------- */
  // Matches the first http(s)/file/blob URL in a stack trace. Our own frames are
  // chrome-extension:// or moz-extension:// URLs, so they never match.
  const URL_RE = /((?:blob:)?(?:https?|file):\/\/[^\s()@]+?):\d+:\d+/;
  const budget = new Map();
  const lastCaller = new Map();

  function caller(tech) {
    const left = budget.has(tech) ? budget.get(tech) : STACK_BUDGET;
    if (left <= 0) return lastCaller.get(tech) || null;
    budget.set(tech, left - 1);
    const limit = ErrorCtor.stackTraceLimit;
    if (typeof limit === 'number') ErrorCtor.stackTraceLimit = 40; // V8 only; pages can lower it
    const stack = String(new ErrorCtor().stack || '');
    if (typeof limit === 'number') ErrorCtor.stackTraceLimit = limit;
    const m = apply(exec, URL_RE, [stack]);
    const src = m ? m[1].replace(/[?#].*$/, '') : null;
    if (src) lastCaller.set(tech, src);
    return src;
  }

  /* ---------- batching ---------- */
  const tally = new Map(); // "tech\0script" -> [tech, script, count, extra]
  let timer = 0;

  function hit(tech, extra) {
    add(tech, caller(tech), 1, extra);
  }
  function add(tech, src, n, extra) {
    const key = tech + '\u0000' + (src || '');
    const row = tally.get(key);
    if (row) { row[2] += n; if (typeof extra === 'number') row[3] = Math.max(row[3] ?? 0, extra); }
    else tally.set(key, [tech, src, n, extra]);
    if (!timer) timer = later(flush, FLUSH_MS);
  }

  function flush() {
    timer = 0;
    if (!tally.size) return;
    const batch = Array.from(tally.values());
    tally.clear();
    apply(dispatch, doc, [new EventCtor(CHANNEL, { detail: stringify(batch) })]);
  }
  apply(listen, W, ['pagehide', flush]);

  /* ---------- wrapping ---------- */
  // A Proxy keeps the original function's name, length and prototype, and our bookkeeping
  // runs inside try/catch so a bug here can never break the page.
  let busy = false;
  function spyOn(fn, spy) {
    return new ProxyCtor(fn, {
      apply(target, self, args) {
        if (!busy) {
          busy = true;
          try { spy(self, args); } catch (_) { /* never break the page */ } finally { busy = false; }
        }
        return apply(target, self, args);
      }
    });
  }
  function wrapMethod(proto, name, spy) {
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.value !== 'function') return;
    d.value = spyOn(d.value, spy);
    defineProp(proto, name, d);
  }
  function wrapGetter(proto, name, spy) {
    const d = proto && getDesc(proto, name);
    if (!d || typeof d.get !== 'function') return;
    d.get = spyOn(d.get, spy);
    defineProp(proto, name, d);
  }
  const P = name => W[name] && W[name].prototype;

  /* ---------- canvas: drawing text, then reading the pixels back ---------- */
  // Mirrors the OpenWPM heuristic (Englehardt & Narayanan, 2016): text drawn on a canvas of at
  // least 16x16 that is then read back is fingerprinting. Readback without text is reported
  // separately and weighted low, since image editors and upload previews do that legitimately.
  const texted = new WeakSet();
  const markText = ctx => { if (ctx && ctx.canvas) texted.add(ctx.canvas); };
  const readback = canvas => {
    if (!canvas || canvas.width < 16 || canvas.height < 16) return;
    hit(texted.has(canvas) ? 'canvas-fp' : 'canvas-read');
  };

  /* ---------- fonts: measuring the same text in many fonts ---------- */
  const fonts = new Set();
  const sawFont = f => {
    if (typeof f !== 'string' || fonts.has(f) || fonts.size > 1000) return;
    fonts.add(f);
    hit('font-probe', fonts.size);
  };

  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) {
    const proto = P(name);
    wrapMethod(proto, 'fillText', markText);
    wrapMethod(proto, 'strokeText', markText);
    wrapMethod(proto, 'getImageData', ctx => readback(ctx.canvas));
    wrapMethod(proto, 'measureText', ctx => sawFont(ctx.font));
  }
  wrapMethod(P('HTMLCanvasElement'), 'toDataURL', readback);
  wrapMethod(P('HTMLCanvasElement'), 'toBlob', readback);
  wrapMethod(P('OffscreenCanvas'), 'convertToBlob', readback);
  wrapMethod(P('FontFaceSet'), 'check', (_, [font]) => sawFont(font));

  // The DOM version of the same trick, used by FingerprintJS: give hidden <span>s different
  // inline font-family values and compare their sizes. These getters are hot on every page, so
  // the check is one inline-style read, and only explicitly styled elements count.
  const sawElementFont = el => {
    const ff = el && el.style && el.style.fontFamily;
    if (ff) sawFont('dom:' + ff);
  };
  wrapGetter(P('HTMLElement'), 'offsetWidth', sawElementFont);
  wrapGetter(P('HTMLElement'), 'offsetHeight', sawElementFont);
  wrapMethod(P('Element'), 'getBoundingClientRect', sawElementFont);

  /* ---------- WebGL: asking for the real GPU name ---------- */
  const UNMASKED_VENDOR = 0x9245, UNMASKED_RENDERER = 0x9246;
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    wrapMethod(P(name), 'getParameter', (_, [p]) => {
      if (p === UNMASKED_VENDOR || p === UNMASKED_RENDERER) hit('webgl-gpu');
    });
  }

  /* ---------- WebGPU: asking which graphics chip family you have ---------- */
  for (const k of ['vendor', 'architecture', 'device', 'description']) wrapGetter(P('GPUAdapterInfo'), k, () => hit('webgpu'));

  /* ---------- layout measurement: exact sizes of text and elements ---------- */
  // getBoundingClientRect on elements is everywhere in normal layout code, so it isn't counted;
  // the per-line and per-range variants fingerprinters use for text and emoji are.
  let rectCalls = 0;
  const sawRects = () => { if (rectCalls < 100000) hit('rect-probe', ++rectCalls); };
  wrapMethod(P('Element'), 'getClientRects', sawRects);
  wrapMethod(P('Range'), 'getClientRects', sawRects);
  wrapMethod(P('Range'), 'getBoundingClientRect', sawRects);

  /* ---------- audio: rendering a silent sound offline ---------- */
  wrapMethod(P('OfflineAudioContext'), 'startRendering', () => hit('audio-fp'));

  /* ---------- hardware sweep: reading many device properties ---------- */
  const NAV_PROPS = ['hardwareConcurrency', 'deviceMemory', 'platform', 'languages', 'plugins', 'mimeTypes',
    'maxTouchPoints', 'vendor', 'productSub', 'doNotTrack', 'webdriver', 'pdfViewerEnabled', 'connection',
    'cookieEnabled', 'oscpu', 'buildID'];
  const SCREEN_PROPS = ['width', 'height', 'colorDepth', 'pixelDepth', 'availWidth', 'availHeight', 'availLeft', 'availTop'];
  const props = new Set();
  const sawProp = key => { if (props.has(key)) return; props.add(key); hit('hw-sweep', props.size); };
  for (const k of NAV_PROPS) wrapGetter(P('Navigator'), k, () => sawProp('navigator.' + k));
  for (const k of SCREEN_PROPS) wrapGetter(P('Screen'), k, () => sawProp('screen.' + k));

  /* ---------- one-shot lookups ---------- */
  wrapMethod(P('Navigator'), 'getBattery', () => hit('battery'));
  wrapMethod(P('MediaDevices'), 'enumerateDevices', () => hit('media-devices'));
  wrapMethod(P('SpeechSynthesis'), 'getVoices', () => hit('voices'));
  wrapMethod(P('Keyboard'), 'getLayoutMap', () => hit('keyboard-layout'));
  wrapMethod(P('StorageManager'), 'estimate', () => hit('storage-estimate'));
  wrapMethod(P('NavigatorUAData'), 'getHighEntropyValues', () => hit('client-hints'));
  wrapMethod(P('RTCPeerConnection'), 'createOffer', () => hit('webrtc'));
  wrapMethod(P('RTCPeerConnection'), 'createDataChannel', () => hit('webrtc'));

  /* ---------- page-wide keystroke listeners ---------- */
  // Recorded for every script; the scorer only counts ones from third-party domains,
  // since a site's own keyboard shortcuts are normal.
  const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress', 'input']);
  wrapMethod(P('EventTarget'), 'addEventListener', (target, [type]) => {
    if (!KEY_EVENTS.has(type)) return;
    const d = W.document;
    if (target === W || target === d || target === d.documentElement || target === d.body) hit('key-listen');
  });

  /* ---------- Web Workers ---------- */
  // Content scripts can't run inside workers, so each new Worker starts from a small blob:
  // script that runs worker-prelude.js (detection, plus the page's protection if it has any)
  // and then loads the original script. Results come back on a private MessagePort.
  // Only where the page's Content-Security-Policy allows blob: workers, which the background
  // reads from the response headers; anywhere else the worker runs untouched rather than broken.
  // SharedWorker and ServiceWorker aren't covered: wrapping them would change which worker the
  // page connects to.
  const PRELUDE = '__WSS_WORKER_PRELUDE__'; // replaced with worker-prelude.js by scripts/build.mjs
  const ownDoc = W.document;
  const NativeWorker = W.Worker;
  if (PRELUDE.includes('wssWorkerPrelude') && NativeWorker) {
    const detailOf = getDesc(CustomEvent.prototype, 'detail').get;
    const random32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
    const { createObjectURL, revokeObjectURL } = URL;
    const BlobCtor = Blob, URLCtor = URL, ChannelCtor = MessageChannel;
    const postMessage = NativeWorker.prototype.postMessage;
    const querySelector = Document.prototype.querySelector;
    const parse = JSON.parse;

    // Ask the bridge, privately (same pattern as protection's seed), whether blob: workers are allowed.
    let blobOK = false;
    const channel = 'wss:' + random32().toString(36) + random32().toString(36);
    apply(listen, ownDoc, [channel, e => {
      try { const m = parse(String(apply(detailOf, e, []))); if (typeof m.blobWorkers === 'boolean') blobOK = m.blobWorkers; } catch (_) { /* ignore */ }
    }]);
    let delivered = false;
    const hello = () => {
      if (!delivered) delivered = !apply(dispatch, ownDoc, [new EventCtor('wss:hooks-hello', { detail: stringify({ channel }), cancelable: true })]);
    };
    apply(listen, ownDoc, ['wss:bridge-ready', hello]);
    hello();

    const start = (target, args, newTarget) => {
      const [url, options] = args;
      // A <meta> CSP can also forbid blob: workers; don't try to interpret it, just stand aside.
      if (!blobOK || apply(querySelector, ownDoc, ['meta[http-equiv="Content-Security-Policy" i]'])) return null;
      const href = new URLCtor(String(url), ownDoc.baseURI).href;
      if (!/^(https?|blob):/.test(href)) return null;
      const module = !!options && options.type === 'module';
      const config = { url: href, module, protect: protection ? protection.workerConfig() : null };
      const source = module
        ? `const ready = (${PRELUDE})(${stringify(config)});\ntry { await import(${stringify(href)}); } finally { ready(); }`
        : `(${PRELUDE})(${stringify(config)});\nimportScripts(${stringify(href)});`;
      const blobUrl = createObjectURL(new BlobCtor([source], { type: 'text/javascript' }));
      const worker = Reflect.construct(target, [blobUrl, options], newTarget);
      later(() => revokeObjectURL(blobUrl), 30000); // after the worker has surely fetched it
      const { port1, port2 } = new ChannelCtor();
      port1.onmessage = e => {
        if (!Array.isArray(e.data)) return;
        for (const [tech, src, n, extra] of e.data) if (typeof tech === 'string' && typeof n === 'number') add(tech, src, n, extra);
      };
      apply(postMessage, worker, [{ __wss: true }, [port2]]);
      return worker;
    };
    const d = getDesc(W, 'Worker');
    d.value = new ProxyCtor(NativeWorker, {
      construct(target, args, newTarget) {
        let worker = null;
        try { worker = start(target, args, newTarget); } catch (_) { /* fall back to the real thing */ }
        return worker || Reflect.construct(target, args, newTarget);
      },
    });
    defineProp(W, 'Worker', d);
  }
})();

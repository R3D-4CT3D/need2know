// Runs in the page's own JavaScript world ("MAIN") at document_start, before any page script.
// It wraps the browser APIs that fingerprinters rely on, notes which script called them, and
// hands tallies to bridge.js. It never changes what an API returns, so sites behave normally.
(() => {
  'use strict';

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
  const later = setTimeout.bind(W);
  const doc = document;

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
    const src = caller(tech);
    const key = tech + '\u0000' + (src || '');
    const row = tally.get(key);
    if (row) { row[2]++; if (extra !== undefined) row[3] = extra; }
    else tally.set(key, [tech, src, 1, extra]);
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

  /* ---------- WebGL: asking for the real GPU name ---------- */
  const UNMASKED_VENDOR = 0x9245, UNMASKED_RENDERER = 0x9246;
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    wrapMethod(P(name), 'getParameter', (_, [p]) => {
      if (p === UNMASKED_VENDOR || p === UNMASKED_RENDERER) hit('webgl-gpu');
    });
  }

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
    if (target === W || target === doc || target === doc.documentElement || target === doc.body) hit('key-listen');
  });
})();

// Protection: layout measurement noise. Fingerprinters measure the exact size and position of
// text, emoji and transformed elements (getClientRects, getBoundingClientRect, Range rects): the
// sub-pixel results depend on fonts, rendering and settings.
// Chromium lays out in 1/64 px units, so real values are multiples of 1/64. Whole-pixel values are
// left exactly as they are, so ordinary layout code is unaffected. Fractional values (where the
// fingerprint lives) move by -1, 0 or +1 of those steps, chosen by the per-site seed and the value
// itself: the same value always gives the same answer on one site. A smaller nudge could simply be
// rounded away; one whole step can't be undone without the seed, and is about 0.016 px on screen.
(() => {
  'use strict';
  const k = window.__wssProtect;
  if (!k) return;
  const { P, seedNow, mix, adjust, enable } = k;
  enable('rects');

  const shift = v => {
    if (typeof v !== 'number' || !Number.isFinite(v) || Number.isInteger(v)) return v;
    const q = Math.round(v * 64);
    return (q + (mix(seedNow() ^ mix(q | 0)) % 3) - 1) / 64;
  };
  // DOMRect is mutable, so rects are adjusted in place and keep their type.
  const noise = r => {
    if (!r) return r;
    r.x = shift(r.x); r.y = shift(r.y); r.width = shift(r.width); r.height = shift(r.height);
    return r;
  };
  const noiseList = list => { for (let i = 0; i < list.length; i++) noise(list[i]); return list; };

  adjust(P('Element'), 'getBoundingClientRect', noise);
  adjust(P('Element'), 'getClientRects', noiseList);
  adjust(P('Range'), 'getBoundingClientRect', noise);
  adjust(P('Range'), 'getClientRects', noiseList);
})();

// Protection: canvas noise. Covers 2D canvas exports and reads, and WebGL pixel reads.
// Uses the helpers core.js shares; see core.js for how the files fit together.
(() => {
  'use strict';
  const k = window.__wssProtect;
  if (!k) return;
  const { W, P, apply, doc, seedNow, mix, override, adjust } = k;

  /* ---------- canvas noise ---------- */
  // Sets the lowest bit of one color channel in about 10% of visible pixels. Which pixels,
  // which channel and which bit depend on the seed, the pixel's absolute position, and its
  // color with the lowest bits masked off. So:
  //   - the same drawing always reads back the same on one site;
  //   - drawing a known test image doesn't reveal the pattern for other drawings;
  //   - it's idempotent: reading pixels, writing them back and reading again changes nothing,
  //     exactly like an unmodified browser, so a round-trip test can't expose it.
  // Only fully opaque pixels are touched: blank canvases stay blank, and a one-bit change to a
  // semi-transparent pixel can be rounded away when the browser stores it premultiplied, which
  // would make toDataURL() and getImageData() disagree.
  const MAX_PIXELS = 4e6;
  function perturbPixels(data, sx, sy, w) {
    const s = seedNow();
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

  // Natives captured before they're wrapped, so our own copying is invisible to hooks.js.
  const createEl = Document.prototype.createElement;
  const getContext = P('HTMLCanvasElement').getContext;
  const C2D = P('CanvasRenderingContext2D');
  const drawImage = C2D.drawImage, getImageData = C2D.getImageData, putImageData = C2D.putImageData;
  const OC = W.OffscreenCanvas;
  const OC2D = P('OffscreenCanvasRenderingContext2D');
  const ocGetContext = OC && OC.prototype.getContext;
  const OC_NATIVE = OC2D && { drawImage: OC2D.drawImage, getImageData: OC2D.getImageData, putImageData: OC2D.putImageData };
  const C2D_NATIVE = { drawImage, getImageData, putImageData };

  // A noised copy to export instead of the original, so the visible canvas never changes.
  function noisedCopy(canvas, offscreen) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h || w * h > MAX_PIXELS) return null;
    let copy, ctx;
    if (offscreen) { copy = new OC(w, h); ctx = apply(ocGetContext, copy, ['2d']); }
    else { copy = apply(createEl, doc, ['canvas']); copy.width = w; copy.height = h; ctx = apply(getContext, copy, ['2d']); }
    const n = offscreen ? OC_NATIVE : C2D_NATIVE;
    apply(n.drawImage, ctx, [canvas, 0, 0]);
    const img = apply(n.getImageData, ctx, [0, 0, w, h]);
    perturbPixels(img.data, 0, 0, w);
    apply(n.putImageData, ctx, [img, 0, 0]);
    return copy;
  }
  const exportNoised = offscreen => (native, self, args) => {
    let target = self;
    try { target = noisedCopy(self, offscreen) || self; } catch (_) { /* e.g. a tainted canvas: let the real call throw */ }
    return apply(native, target, args);
  };
  override(P('HTMLCanvasElement'), 'toDataURL', exportNoised(false));
  override(P('HTMLCanvasElement'), 'toBlob', exportNoised(false));
  if (OC && OC2D) override(OC.prototype, 'convertToBlob', exportNoised(true));

  for (const proto of [C2D, OC2D]) {
    adjust(proto, 'getImageData', (img, args) => { perturbPixels(img.data, args[0] | 0, args[1] | 0, img.width); return img; });
  }

  // WebGL pixel reads get the same noise as 2D canvases.
  const RGBA = 0x1908, UNSIGNED_BYTE = 0x1401;
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    adjust(P(name), 'readPixels', (ret, args) => {
      const [x, y, w, , format, type, pixels] = args;
      if (format === RGBA && type === UNSIGNED_BYTE && pixels && pixels.BYTES_PER_ELEMENT === 1) perturbPixels(pixels, x | 0, y | 0, w | 0 || 1);
      return ret;
    });
  }
})();

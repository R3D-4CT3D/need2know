// Protection: standard fonts only. Font probing measures text in "SomeFont", fallback and
// compares it with the fallback alone; a different size means SomeFont is installed. This makes
// those measurements report what a standard install of your OS would: fonts that ship with the
// OS keep measuring normally, other locally installed fonts measure as if missing. Everyone on
// the same OS then shows the same fonts, and sites already know your OS.
// Only measurement changes, never rendering, and only for elements styled with an inline
// font-family (how probes work) or canvas text. Fonts the page loads itself are left alone.
(() => {
  'use strict';
  const k = window.__wssProtect;
  if (!k) return;
  const { W, P, apply, doc, override, aroundGetter, enable } = k;

  // Fonts that ship with each OS. Kept to the core set; anything else counts as "installed by
  // you" and is hidden.
  const STANDARD = {
    windows: ['Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara', 'Comic Sans MS',
      'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi',
      'Georgia', 'Impact', 'Ink Free', 'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode',
      'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue', 'Microsoft PhagsPa',
      'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
      'MS Gothic', 'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe MDL2 Assets', 'Segoe Fluent Icons',
      'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Symbol', 'Segoe UI Variable',
      'SimSun', 'Sitka Text', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings',
      'Wingdings', 'Yu Gothic'],
    mac: ['American Typewriter', 'Andale Mono', 'Apple Chancery', 'Apple Color Emoji', 'Arial', 'Arial Black', 'Avenir',
      'Avenir Next', 'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bradley Hand', 'Brush Script MT', 'Chalkboard', 'Charter',
      'Cochin', 'Comic Sans MS', 'Copperplate', 'Courier', 'Courier New', 'Didot', 'Futura', 'Geneva', 'Georgia',
      'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Herculanum', 'Hoefler Text', 'Impact', 'Lucida Grande', 'Marker Felt',
      'Menlo', 'Monaco', 'Noteworthy', 'Optima', 'Palatino', 'Papyrus', 'Phosphate', 'Rockwell', 'SF Pro', 'SF Mono',
      'Skia', 'Snell Roundhand', 'Tahoma', 'Times', 'Times New Roman', 'Trattatello', 'Trebuchet MS', 'Verdana', 'Zapfino'],
    linux: ['DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif',
      'Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'Noto Color Emoji', 'FreeSans', 'FreeSerif', 'FreeMono'],
    android: ['Roboto', 'Noto Sans', 'Noto Serif', 'Noto Color Emoji', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif'],
    chromeos: ['Roboto', 'Noto Sans', 'Noto Serif', 'Arimo', 'Tinos', 'Cousine'],
  };
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'windows' : /Android/.test(ua) ? 'android' : /CrOS/.test(ua) ? 'chromeos'
    : /Mac OS X|iPhone|iPad/.test(ua) ? 'mac' : 'linux';
  const standard = new Set(STANDARD[os].map(f => f.toLowerCase()));
  enable('fonts', [...standard]); // workers get the same list
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif',
    'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset']);

  // Font families the page loads itself (@font-face) are its own business, not a probe.
  const fontsIterator = doc.fonts && W.FontFaceSet && P('FontFaceSet').values;
  const pageFonts = () => {
    const out = new Set();
    try { for (const face of apply(fontsIterator, doc.fonts, [])) out.add(String(face.family).replace(/^["']|["']$/g, '').toLowerCase()); } catch (_) { /* none */ }
    return out;
  };

  const split = list => String(list).split(',').map(f => f.trim()).filter(Boolean);
  const bare = f => f.replace(/^["']|["']$/g, '').trim().toLowerCase();
  // For a family list, the version with non-standard local fonts removed, or null if nothing changes.
  function standardOnly(list) {
    const families = split(list);
    let page = null;
    const kept = families.filter(f => {
      const name = bare(f);
      if (GENERIC.has(name) || standard.has(name)) return true;
      return (page ??= pageFonts()).has(name);
    });
    if (kept.length === families.length) return null;
    return kept.length ? kept.join(', ') : 'sans-serif';
  }

  /* ---------- canvas: measureText ---------- */
  const C2D = P('CanvasRenderingContext2D');
  const OC2D = P('OffscreenCanvasRenderingContext2D');
  for (const proto of [C2D, OC2D]) {
    const fontDesc = proto && Object.getOwnPropertyDescriptor(proto, 'font');
    if (!fontDesc) continue;
    override(proto, 'measureText', (native, self, args) => {
      const font = apply(fontDesc.get, self, []);
      // The CSS font shorthand: style/weight/size first, then the family list.
      const m = /^(.*?\d[\d.]*(?:px|pt|em|rem|%|ex|ch|vw|vh)(?:\s*\/\s*\S+)?\s+)(.+)$/.exec(font);
      const families = m && standardOnly(m[2]);
      if (!families) return apply(native, self, args);
      apply(fontDesc.set, self, [m[1] + families]);
      try { return apply(native, self, args); } finally { apply(fontDesc.set, self, [font]); }
    });
  }

  /* ---------- DOM: sizing elements styled with an inline font-family ---------- */
  // The family is swapped and restored around a single native measurement, within one task,
  // so nothing is ever painted with the swapped font. (A MutationObserver watching the element's
  // style attribute would see the swap; probes don't, and normal pages rarely do.)
  // CSSStyleDeclaration methods, not the fontFamily property: Chromium defines that property on
  // each style object rather than the prototype, so there's nothing shared to capture.
  const styleOf = Object.getOwnPropertyDescriptor(P('HTMLElement'), 'style');
  const CSD = P('CSSStyleDeclaration');
  const { getPropertyValue, getPropertyPriority, setProperty } = CSD;
  function measured(el, read) {
    let style, family, priority, swapped = null;
    try {
      style = apply(styleOf.get, el, []);
      family = apply(getPropertyValue, style, ['font-family']);
      if (family) { swapped = standardOnly(family); priority = apply(getPropertyPriority, style, ['font-family']); }
    } catch (_) { /* not a styled element */ }
    if (!swapped) return read();
    apply(setProperty, style, ['font-family', swapped, priority]);
    try { return read(); } finally { apply(setProperty, style, ['font-family', family, priority]); }
  }
  if (styleOf && setProperty) {
    for (const name of ['offsetWidth', 'offsetHeight']) {
      aroundGetter(P('HTMLElement'), name, (native, self) => measured(self, () => apply(native, self, [])));
    }
    override(P('Element'), 'getBoundingClientRect', (native, self, args) => measured(self, () => apply(native, self, args)));
  }
})();

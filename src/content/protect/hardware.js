// Protection: generic CPU and memory. Cores and memory rounded to common values.
// Uses the helpers core.js shares; see core.js for how the files fit together.
(() => {
  'use strict';
  const k = window.__wssProtect;
  if (!k) return;
  const { P, overrideGetter } = k;

  overrideGetter(P('Navigator'), 'hardwareConcurrency', v => typeof v === 'number' ? (v <= 4 ? 4 : 8) : v);
  overrideGetter(P('Navigator'), 'deviceMemory', v => typeof v === 'number' ? (v >= 4 ? 8 : 4) : v);
})();

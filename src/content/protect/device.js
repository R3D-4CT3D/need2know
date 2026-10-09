// Protection: fewer device details. Battery, devices, voices, keyboard layout and exact OS version.
// Uses the helpers core.js shares; see core.js for how the files fit together.
(() => {
  'use strict';
  const k = window.__wssProtect;
  if (!k) return;
  const { P, override, overrideGetter, adjust } = k;

  const lang = String(navigator.language || 'en').split('-')[0].toLowerCase();
  for (const [k, value] of [['level', 1], ['charging', true], ['chargingTime', 0], ['dischargingTime', Infinity]]) {
    overrideGetter(P('BatteryManager'), k, () => value);
  }
  // Before you grant camera/mic access, sites only need to know a kind exists, not how many.
  adjust(P('MediaDevices'), 'enumerateDevices', p => p.then(list => {
    if (list.some(d => d.label)) return list;
    const kinds = new Set();
    return list.filter(d => !kinds.has(d.kind) && kinds.add(d.kind));
  }));
  // Only voices for your own language: enough for read-aloud, without the full OS inventory.
  adjust(P('SpeechSynthesis'), 'getVoices', voices => voices.filter(v => String(v.lang).toLowerCase().startsWith(lang)));
  override(P('Keyboard'), 'getLayoutMap', () => Promise.reject(new DOMException('getLayoutMap() is not allowed.', 'SecurityError')));
  adjust(P('NavigatorUAData'), 'getHighEntropyValues', p => p.then(v => {
    const major = s => String(s).split('.')[0] + '.0.0.0';
    if ('model' in v) v.model = '';
    if (v.platformVersion) v.platformVersion = String(v.platformVersion).split('.')[0] + '.0.0';
    if (v.uaFullVersion) v.uaFullVersion = major(v.uaFullVersion);
    if (Array.isArray(v.fullVersionList)) v.fullVersionList = v.fullVersionList.map(b => ({ brand: b.brand, version: major(b.version) }));
    return v;
  }));
})();

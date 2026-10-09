// User settings, stored in storage.local under "settings". Everything is the user's choice:
// protection starts off, and each site, defense and company can be set individually.
export const DEFAULTS = Object.freeze({
  protectDefault: false,     // protection for sites without their own setting
  sites: {},                 // per-site overrides: { 'example.com': 'on' | 'off' }
  privateMode: 'follow',     // private windows: 'follow' the above, or 'always' protect
  pausedUntil: 0,            // protection paused until this time (ms); -1 = until browser restart
  defenses: { canvas: true, audio: true, gpu: true, hardware: true, device: true, fonts: true },
  blockReplay: true,         // where protection is on: block session recorders
  blockFingerprinters: true, // ...fingerprinting services
  blockFraud: false,         // ...fraud and bot detection (can break logins and payments)
  allowedVendors: [],        // companies never blocked, by name from vendors.js
  gpc: true,                 // Global Privacy Control signal, on every site
  webrtc: false,             // limit WebRTC to the default public interface
  typingWarning: true,       // warn before typing on pages with a session recorder
  badge: 'score',            // toolbar badge: 'score' or 'none'
  history: true,             // remember sites that fingerprinted you
  historyDays: 90,           // forget sites not seen for this long (0 = keep forever)
  historyExclude: [],        // sites never recorded in history
});

// What each defense covers, for the Settings page and the advice text.
export const DEFENSES = {
  canvas: { title: 'Canvas noise', detail: 'Hidden drawings and WebGL pixel reads come back slightly different on each site.' },
  audio: { title: 'Audio noise', detail: 'Silent test sounds measure slightly differently on each site.' },
  gpu: { title: 'Generic graphics chip', detail: 'Sites see your GPU brand (e.g. "NVIDIA Graphics"), not the exact model.' },
  hardware: { title: 'Generic CPU and memory', detail: 'Processor cores and memory are rounded to common values.' },
  device: { title: 'Fewer device details', detail: 'Battery, speech voices, keyboard layout, camera and mic count, and exact OS version are hidden or generalized.' },
  fonts: { title: 'Standard fonts only', detail: 'Font probes see only the fonts that come with your operating system, not ones you installed (like Office, Adobe or coding fonts). Pages still display with your real fonts.' },
};

export async function loadSettings(api) {
  const { settings } = await api.storage.local.get('settings');
  return normalize(settings);
}

export function normalize(stored = {}) {
  // Only known keys survive, so an imported file can't add anything unexpected.
  const known = Object.fromEntries(Object.entries(stored ?? {}).filter(([k]) => k in DEFAULTS || k === 'allowlist'));
  stored = known;
  const s = { ...DEFAULTS, ...stored };
  s.sites = { ...stored.sites };
  // v0.2 development builds kept an "allowlist" of sites with protection off.
  for (const site of stored.allowlist ?? []) s.sites[site] ??= 'off';
  delete s.allowlist;
  delete s.protect;
  s.defenses = { ...DEFAULTS.defenses, ...stored.defenses };
  s.allowedVendors = [...(stored.allowedVendors ?? [])];
  s.historyExclude = [...(stored.historyExclude ?? [])];
  return s;
}

export async function saveSettings(api, patch) {
  const next = normalize({ ...(await loadSettings(api)), ...patch });
  await api.storage.local.set({ settings: next });
  return next;
}

// Is protection on for this site, and is that the default or the site's own setting?
export function siteMode(settings, site) {
  const custom = settings.sites[site] ?? null;
  return { on: custom ? custom === 'on' : settings.protectDefault, custom };
}

export const isPaused = (s, now = Date.now()) => s.pausedUntil === -1 || s.pausedUntil > now;

// Set a site to on or off; matching the default removes the override.
export function withSite(settings, site, on) {
  const sites = { ...settings.sites };
  if (on === settings.protectDefault) delete sites[site];
  else sites[site] = on ? 'on' : 'off';
  return sites;
}

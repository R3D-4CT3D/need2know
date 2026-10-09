// "How to stop this" advice, tailored to the browser the extension is running in.
// Kept to settings that exist in current versions; menu paths are written the way each
// browser labels them.
import { TECHNIQUES } from './techniques.js';
import { DEFENSES } from './settings.js';

export const BROWSERS = {
  chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', firefox: 'Firefox',
};

export async function detectBrowser(nav = globalThis.navigator) {
  try { if (nav.brave && await nav.brave.isBrave()) return 'brave'; } catch { /* not Brave */ }
  const ua = nav.userAgent || '';
  const brands = (nav.userAgentData?.brands ?? []).map(b => b.brand).join(' ');
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua) || /Edge/.test(brands)) return 'edge';
  if (/OPR\//.test(ua) || /Opera/.test(brands)) return 'opera';
  if (/Vivaldi/.test(ua) || /Vivaldi/.test(brands)) return 'vivaldi';
  return 'chrome';
}

// The single most useful built-in setting in each browser.
const BUILT_IN = {
  firefox: 'In Firefox, open Settings → Privacy & Security → Enhanced Tracking Protection and choose Strict. That blocks known fingerprinters and limits what suspected ones can read.',
  edge: 'In Edge, open Settings → Privacy, search, and services → Tracking prevention and choose Strict.',
  brave: 'In Brave, click the lion icon (Shields) and set trackers & ads blocking to Aggressive for this site.',
  opera: 'In Opera, open Settings → Privacy protection and turn on Block Trackers.',
  vivaldi: 'In Vivaldi, open Settings → Privacy and Security → Tracker and Ad Blocking and choose Block Trackers.',
  chrome: 'Chrome has no built-in fingerprinting protection. Adding uBlock Origin Lite stops many tracking scripts before they run.',
};

// Advice for things Protect mode can't fully handle, by technique.
const SPECIFIC = {
  'font-probe': {
    all: 'Turn on "Standard fonts only" so probes see only the fonts that come with your operating system. Every unusual font you install makes you easier to single out, so uninstalling ones you don\'t use helps too.',
    firefox: 'Firefox\'s Strict tracking protection limits websites to standard system fonts.',
    brave: 'Brave limits websites to standard system fonts while Shields are up.',
  },
  'key-listen': {
    all: 'Extensions can\'t safely stop a script from listening without breaking the page. Avoid typing anything sensitive here, or block this company\'s script with uBlock Origin (Lite).',
  },
  'webrtc': {
    all: 'Turn on "Prevent WebRTC IP leaks" in this extension\'s settings. If you use a VPN, also enable its WebRTC leak protection.',
  },
  'storage-estimate': {
    all: 'Low risk on its own: it hints at your disk size. No setting hides it without breaking offline features.',
  },
  'hw-sweep': {
    all: 'Protect mode generalizes your CPU core count and memory. Screen size still shows; a common window size (maximized on a common screen) blends in best.',
  },
  'fraud-vendor': {
    all: 'These usually run on logins and checkouts. You can block them in Settings, but expect some payments or sign-ins to fail.',
  },
};

// Returns { done: string|null, steps: string[] } for one report item.
//   context.settings  current extension settings
//   context.siteOn    protection is on for this site
export function adviceFor(item, browser, { settings, siteOn } = {}) {
  const steps = [];
  let done = null;
  if (item.status === 'neutralized') done = 'Stopped: the site got noise or a generic answer instead of your real value.';
  else if (item.status === 'blocked') done = 'Stopped: this company\'s script was blocked before it loaded.';
  else if (item.status === 'partial') done = 'Partly stopped: some of these values were generalized.';

  const specific = SPECIFIC[item.id];
  if (specific?.[browser]) steps.push(specific[browser]);
  if (specific?.all) steps.push(specific.all);

  // Point at the one setting in this extension that would have stopped it.
  if (item.status === 'active' && settings) {
    const def = TECHNIQUES[item.id] ?? {};
    const allowed = item.scripts?.map(s => s.vendor).filter(v => v && settings.allowedVendors.includes(v)) ?? [];
    let fix = null;
    if (!siteOn && (def.guard || def.defense === 'block')) fix = 'Protection is off for this site. Turn it on above.';
    else if (def.guard && !settings.defenses[def.guard]) fix = `Turn on "${DEFENSES[def.guard].title}" in Settings.`;
    else if (allowed.length) fix = `You allowed ${[...new Set(allowed)].join(' and ')} in Settings, so it isn't blocked.`;
    else if (item.id === 'session-replay' && !settings.blockReplay) fix = 'Turn on "Block session recorders" in Settings.';
    else if (item.id === 'fp-vendor' && !settings.blockFingerprinters) fix = 'Turn on "Block fingerprinting services" in Settings.';
    else if (item.id === 'webrtc' && settings.webrtc) steps.splice(0, steps.length, 'WebRTC IP protection is on, so the page can only see the same public address any site sees.');
    if (fix) steps.unshift(fix);
  }
  return { done, steps: [...new Set(steps)] };
}

// The one built-in browser setting worth changing, shown once rather than on every item.
export const browserTip = browser => BUILT_IN[browser] ?? BUILT_IN.chrome;

// Browser hardening checklist for the Checkup page.
export const HARDEN = {
  firefox: [
    { id: 'etp', text: 'Settings → Privacy & Security → Enhanced Tracking Protection → Strict' },
    { id: 'gpc-native', text: 'Settings → Privacy & Security → Website Privacy Preferences → "Tell websites not to sell or share my data"' },
    { id: 'ubo', text: 'Install uBlock Origin from addons.mozilla.org' },
  ],
  edge: [
    { id: 'tp', text: 'Settings → Privacy, search, and services → Tracking prevention → Strict' },
    { id: 'ubo', text: 'Install uBlock Origin Lite from the Edge Add-ons store' },
  ],
  brave: [
    { id: 'shields', text: 'Shields → Trackers & ads blocking → Aggressive (or set it as the default in Settings → Shields)' },
    { id: 'fp', text: 'Settings → Shields → make sure fingerprinting blocking is on' },
  ],
  opera: [
    { id: 'trackers', text: 'Settings → Privacy protection → Block Trackers' },
    { id: 'ubo', text: 'Install uBlock Origin Lite' },
  ],
  vivaldi: [
    { id: 'trackers', text: 'Settings → Privacy and Security → Tracker and Ad Blocking → Block Trackers' },
  ],
  chrome: [
    { id: 'ubo', text: 'Install uBlock Origin Lite from the Chrome Web Store' },
    { id: '3pc', text: 'Settings → Privacy and security → Third-party cookies → Block third-party cookies' },
    { id: 'switch', text: 'For the strongest built-in protection, consider Firefox (Strict mode) or Brave' },
  ],
};

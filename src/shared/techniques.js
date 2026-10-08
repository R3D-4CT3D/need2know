// Everything the extension can catch, with plain-English explanations and score weights.
// Weights roughly follow how identifying each signal is; the total score is capped at 100.
//   min             the hook's running count (row.x) must reach this before it counts
//   thirdPartyOnly  only scripts from other companies' domains count
//   vendor          derived from the domains a page contacts, not from an API hook

const list = names => names.length <= 1 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export const TECHNIQUES = {
  'canvas-fp': {
    title: 'Canvas fingerprinting', weight: 25,
    why: () => 'Drew hidden text and read the pixels back. Tiny rendering differences from your GPU, drivers and fonts make the result unique to you.',
  },
  'session-replay': {
    title: 'Session recording', weight: 25, vendor: true,
    why: ({ vendors }) => `Loaded ${list(vendors)}, which can record your mouse, clicks, scrolling and typing so someone can replay your visit later.`,
  },
  'audio-fp': {
    title: 'Audio fingerprinting', weight: 20,
    why: () => 'Rendered a silent sound and measured the output. Your audio hardware and software leave a numeric signature.',
  },
  'font-probe': {
    title: 'Font probing', weight: 20, min: 20,
    why: r => `Measured text in ${r.x} font settings to work out which fonts you have. That reveals your OS and apps like Office or Adobe.`,
  },
  'fp-vendor': {
    title: 'Commercial fingerprinting service', weight: 20, vendor: true,
    why: ({ vendors }) => `Loaded ${list(vendors)}, a company whose product is identifying devices across visits.`,
  },
  'webgl-gpu': {
    title: 'Graphics chip lookup', weight: 15,
    why: () => 'Asked WebGL for your exact GPU model, one of the most identifying single values a site can get.',
  },
  'hw-sweep': {
    title: 'Hardware sweep', weight: 10, min: 10,
    why: r => `Read ${r.x} device and screen properties, such as processor cores, memory, plugins and screen size.`,
  },
  'key-listen': {
    title: 'Third-party keystroke listener', weight: 10, thirdPartyOnly: true,
    why: () => 'A script from another company is listening to every key you press on this page.',
  },
  'fraud-vendor': {
    title: 'Fraud and bot detection', weight: 10, vendor: true,
    why: ({ vendors }) => `Loaded ${list(vendors)}. Usually there to stop fraud or bots, but it builds a detailed profile of your device to do it.`,
  },
  'media-devices': {
    title: 'Camera and mic count', weight: 8,
    why: () => 'Counted your cameras, microphones and speakers without asking permission.',
  },
  'webrtc': {
    title: 'WebRTC connection', weight: 8,
    why: () => 'Set up a peer connection, which can expose your local and public IP addresses. Normal on video-call sites, suspicious elsewhere.',
  },
  'client-hints': {
    title: 'Detailed device hints', weight: 6,
    why: () => 'Requested your exact OS version, CPU architecture or device model.',
  },
  'battery': {
    title: 'Battery status', weight: 6,
    why: () => 'Read your battery level and charging state, which once let trackers link visits across sites.',
  },
  'voices': {
    title: 'Speech voices', weight: 6,
    why: () => 'Listed your text-to-speech voices, which depend on your OS and installed language packs.',
  },
  'keyboard-layout': {
    title: 'Keyboard layout', weight: 6,
    why: () => 'Read your keyboard layout, a hint at the country your computer is set up for.',
  },
  'storage-estimate': {
    title: 'Storage quota', weight: 4,
    why: () => 'Checked how much disk space it may use. That hints at your drive size and can reveal private browsing.',
  },
  'canvas-read': {
    title: 'Canvas read', weight: 2,
    why: () => 'Read pixels back from a canvas without drawing text first. Usually harmless, like an image preview.',
  },
};

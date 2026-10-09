// Everything the extension can catch, with plain-English explanations and score weights.
// Weights roughly follow how identifying each signal is; the total score is capped at 100.
//   min             the hook's running count (row.x) must reach this before it counts
//   thirdPartyOnly  only scripts from other companies' domains count
//   vendor          derived from the domains a page contacts, not from an API hook
//   defense         what protection does about it: 'noise', 'generic', 'partial' or 'block'
//   guard           which defense setting covers it (settings.defenses, content/protect/*.js)

const list = names => names.length <= 1 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export const TECHNIQUES = {
  'canvas-fp': {
    title: 'Canvas fingerprinting', weight: 25, defense: 'noise', guard: 'canvas',
    why: () => 'Drew hidden text and read the pixels back. Tiny rendering differences from your GPU, drivers and fonts make the result unique to you.',
  },
  'session-replay': {
    title: 'Session recording', weight: 25, vendor: true, defense: 'block',
    why: ({ vendors }) => `Loaded ${list(vendors)}, which can record your mouse, clicks, scrolling and typing so someone can replay your visit later.`,
  },
  'audio-fp': {
    title: 'Audio fingerprinting', weight: 20, defense: 'noise', guard: 'audio',
    why: () => 'Rendered a silent sound and measured the output. Your audio hardware and software leave a numeric signature.',
  },
  'font-probe': {
    title: 'Font probing', weight: 20, min: 20, defense: 'generic', guard: 'fonts',
    why: r => `Measured text in ${r.x} font settings to work out which fonts you have. That reveals your OS and apps like Office or Adobe.`,
  },
  'fp-vendor': {
    title: 'Commercial fingerprinting service', weight: 20, vendor: true, defense: 'block',
    why: ({ vendors }) => `Loaded ${list(vendors)}, a company whose product is identifying devices across visits.`,
  },
  'webgl-gpu': {
    title: 'Graphics chip lookup', weight: 15, defense: 'generic', guard: 'gpu',
    why: () => 'Asked WebGL for your exact GPU model, one of the most identifying single values a site can get.',
  },
  'webgpu': {
    title: 'WebGPU graphics lookup', weight: 10, defense: 'generic', guard: 'gpu',
    why: () => 'Asked WebGPU which graphics chip family you have, a newer route to the same information as WebGL.',
  },
  'rect-probe': {
    title: 'Layout measurement probing', weight: 8, min: 30, defense: 'noise', guard: 'rects',
    why: r => `Measured the exact size and position of text ${r.x} times. Sub-pixel differences in how your browser lays out text and emoji identify your setup. Normal for text editors.`,
  },
  'hw-sweep': {
    title: 'Hardware sweep', weight: 10, min: 10, defense: 'partial', guard: 'hardware',
    why: r => `Read ${r.x} device and screen properties, such as processor cores, memory, plugins and screen size.`,
  },
  'key-listen': {
    title: 'Third-party keystroke listener', weight: 10, thirdPartyOnly: true,
    why: () => 'A script from another company is listening to every key you press on this page.',
  },
  'fraud-vendor': {
    title: 'Fraud and bot detection', weight: 10, vendor: true, defense: 'block',
    why: ({ vendors }) => `Loaded ${list(vendors)}. Usually there to stop fraud or bots, but it builds a detailed profile of your device to do it.`,
  },
  'media-devices': {
    title: 'Camera and mic count', weight: 8, defense: 'generic', guard: 'device',
    why: () => 'Counted your cameras, microphones and speakers without asking permission.',
  },
  'webrtc': {
    title: 'WebRTC connection', weight: 8,
    why: () => 'Set up a peer connection, which can expose your local and public IP addresses. Normal on video-call sites, suspicious elsewhere.',
  },
  'client-hints': {
    title: 'Exact OS version and device model', weight: 6, defense: 'generic', guard: 'device',
    why: () => 'Asked your browser for extra detail it doesn\'t share by default: your exact operating system version, processor type and, on phones, the device model.',
  },
  'battery': {
    title: 'Battery status', weight: 6, defense: 'generic', guard: 'device',
    why: () => 'Read your battery level and charging state, which once let trackers link visits across sites.',
  },
  'voices': {
    title: 'Speech voices', weight: 6, defense: 'generic', guard: 'device',
    why: () => 'Listed your text-to-speech voices, which depend on your OS and installed language packs.',
  },
  'keyboard-layout': {
    title: 'Keyboard layout', weight: 6, defense: 'generic', guard: 'device',
    why: () => 'Read your keyboard layout, a hint at the country your computer is set up for.',
  },
  'storage-estimate': {
    title: 'Storage quota', weight: 4,
    why: () => 'Checked how much disk space it may use. That hints at your drive size and can reveal private browsing.',
  },
  'canvas-read': {
    title: 'Canvas read', weight: 2, defense: 'noise', guard: 'canvas',
    why: () => 'Read pixels back from a canvas without drawing text first. Usually harmless, like an image preview.',
  },
};

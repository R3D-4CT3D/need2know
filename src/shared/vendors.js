// Companies whose presence alone is worth flagging. Matched against every domain a page
// contacts (resource loads and the scripts seen calling hooked APIs). Best effort, not exhaustive.
//   replay      records mouse, scrolling, clicks and typing for later playback
//   fingerprint sells device fingerprinting as its product
//   fraud / bot anti-fraud and bot detection; legitimate, but profiles your device in depth
export const VENDORS = [
  { name: 'Hotjar', kind: 'replay', domains: ['hotjar.com', 'hotjar.io'] },
  { name: 'Microsoft Clarity', kind: 'replay', domains: ['clarity.ms'] },
  { name: 'FullStory', kind: 'replay', domains: ['fullstory.com'] },
  { name: 'LogRocket', kind: 'replay', domains: ['logrocket.com', 'logrocket.io', 'lr-ingest.io', 'lr-ingest.com', 'logr-ingest.com'] },
  { name: 'Mouseflow', kind: 'replay', domains: ['mouseflow.com'] },
  { name: 'Smartlook', kind: 'replay', domains: ['smartlook.com', 'smartlook.cloud'] },
  { name: 'Lucky Orange', kind: 'replay', domains: ['luckyorange.com', 'luckyorange.net'] },
  { name: 'Quantum Metric', kind: 'replay', domains: ['quantummetric.com'] },
  { name: 'Contentsquare', kind: 'replay', domains: ['contentsquare.net', 'contentsquare.com'] },
  { name: 'Glassbox', kind: 'replay', domains: ['glassboxdigital.io'] },
  { name: 'Inspectlet', kind: 'replay', domains: ['inspectlet.com'] },
  { name: 'Crazy Egg', kind: 'replay', domains: ['crazyegg.com'] },
  { name: 'Heap', kind: 'replay', domains: ['heapanalytics.com'] },
  { name: 'Yandex Metrica', kind: 'replay', domains: ['mc.yandex.ru', 'mc.yandex.com'] },

  { name: 'Fingerprint (FingerprintJS)', kind: 'fingerprint', domains: ['fpjs.io', 'fpcdn.io', 'fpjscdn.net', 'openfpcdn.io', 'fingerprint.com'] },

  { name: 'ThreatMetrix (LexisNexis)', kind: 'fraud', domains: ['online-metrix.net'] },
  { name: 'iovation (TransUnion)', kind: 'fraud', domains: ['iesnare.com', 'iovation.com'] },
  { name: 'BioCatch', kind: 'fraud', domains: ['biocatch.com'] },
  { name: 'Sift', kind: 'fraud', domains: ['sift.com', 'siftscience.com'] },
  { name: 'Forter', kind: 'fraud', domains: ['forter.com'] },
  { name: 'Riskified', kind: 'fraud', domains: ['riskified.com'] },
  { name: 'Kount', kind: 'fraud', domains: ['kount.net', 'kaxsdc.com'] },
  { name: 'SEON', kind: 'fraud', domains: ['seon.io'] },
  { name: 'Castle', kind: 'fraud', domains: ['castle.io'] },
  { name: 'IPQualityScore', kind: 'fraud', domains: ['ipqualityscore.com'] },
  { name: 'HUMAN (PerimeterX)', kind: 'bot', domains: ['perimeterx.net', 'px-cdn.net', 'px-cloud.net', 'pxchk.net'] },
  { name: 'DataDome', kind: 'bot', domains: ['datadome.co', 'captcha-delivery.com'] },
  { name: 'Arkose Labs', kind: 'bot', domains: ['arkoselabs.com', 'funcaptcha.com'] },
];

export function matchVendor(host) {
  host = String(host || '').toLowerCase();
  if (!host) return null;
  return VENDORS.find(v => v.domains.some(d => host === d || host.endsWith('.' + d))) || null;
}

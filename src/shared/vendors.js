// Companies whose presence alone is worth flagging. Matched against every domain a page
// contacts (resource loads and the scripts seen calling hooked APIs). Best effort, not exhaustive.
//   replay      records mouse, scrolling, clicks and typing for later playback
//   fingerprint sells device fingerprinting as its product
//   fraud / bot anti-fraud and bot detection; legitimate, but profiles your device in depth
// `privacy` links were checked to load (HTTP 200) on 2026-10-08; vendors whose pages couldn't
// be verified have none rather than a guess. `optOut` marks a page with a direct opt-out or
// consumer request form, rather than only a policy.
export const VENDORS = [
  { name: 'Hotjar', kind: 'replay', domains: ['hotjar.com', 'hotjar.io'], privacy: 'https://trust.contentsquare.com/?itemUid=fa5c0555-943f-40a3-834a-379d4b083b97', optOut: true },
  { name: 'Microsoft Clarity', kind: 'replay', domains: ['clarity.ms'], privacy: 'https://www.microsoft.com/en-us/privacy/privacystatement' },
  { name: 'FullStory', kind: 'replay', domains: ['fullstory.com'], privacy: 'https://www.fullstory.com/optout/', optOut: true },
  { name: 'LogRocket', kind: 'replay', domains: ['logrocket.com', 'logrocket.io', 'lr-ingest.io', 'lr-ingest.com', 'logr-ingest.com'], privacy: 'https://logrocket.com/privacy' },
  { name: 'Mouseflow', kind: 'replay', domains: ['mouseflow.com'], privacy: 'https://mouseflow.com/opt-out/', optOut: true },
  { name: 'Smartlook', kind: 'replay', domains: ['smartlook.com', 'smartlook.cloud'], privacy: 'https://help.smartlook.com/docs/privacy-policy' },
  { name: 'Lucky Orange', kind: 'replay', domains: ['luckyorange.com', 'luckyorange.net'], privacy: 'https://www.luckyorange.com/legal/privacy-policy' },
  { name: 'Quantum Metric', kind: 'replay', domains: ['quantummetric.com'], privacy: 'https://www.quantummetric.com/privacy-policy' },
  { name: 'Contentsquare', kind: 'replay', domains: ['contentsquare.net', 'contentsquare.com'], privacy: 'https://contentsquare.com/privacy-center/' },
  { name: 'Glassbox', kind: 'replay', domains: ['glassboxdigital.io'], privacy: 'https://www.glassbox.com/privacy-policy/' },
  { name: 'Inspectlet', kind: 'replay', domains: ['inspectlet.com'], privacy: 'https://www.inspectlet.com/legal' },
  { name: 'Crazy Egg', kind: 'replay', domains: ['crazyegg.com'], privacy: 'https://www.crazyegg.com/opt-out', optOut: true },
  { name: 'Heap', kind: 'replay', domains: ['heapanalytics.com'], privacy: 'https://www.heap.io/privacy' },
  { name: 'Yandex Metrica', kind: 'replay', domains: ['mc.yandex.ru', 'mc.yandex.com'], privacy: 'https://yandex.com/legal/confidential/en/' },

  { name: 'Fingerprint (FingerprintJS)', kind: 'fingerprint', domains: ['fpjs.io', 'fpcdn.io', 'fpjscdn.net', 'openfpcdn.io', 'fingerprint.com'], privacy: 'https://docs.fingerprint.com/docs/privacy-policy' },

  { name: 'ThreatMetrix (LexisNexis)', kind: 'fraud', domains: ['online-metrix.net'], privacy: 'https://consumer.risk.lexisnexis.com/request', optOut: true },
  { name: 'iovation (TransUnion)', kind: 'fraud', domains: ['iesnare.com', 'iovation.com'] },
  { name: 'BioCatch', kind: 'fraud', domains: ['biocatch.com'], privacy: 'https://www.biocatch.com/privacy-policy' },
  { name: 'Sift', kind: 'fraud', domains: ['sift.com', 'siftscience.com'] },
  { name: 'Forter', kind: 'fraud', domains: ['forter.com'], privacy: 'https://www.forter.com/services-privacy-policy/' },
  { name: 'Riskified', kind: 'fraud', domains: ['riskified.com'] },
  { name: 'Kount', kind: 'fraud', domains: ['kount.net', 'kaxsdc.com'] },
  { name: 'SEON', kind: 'fraud', domains: ['seon.io'], privacy: 'https://seon.io/legal-and-security/privacy/' },
  { name: 'Castle', kind: 'fraud', domains: ['castle.io'], privacy: 'https://castle.io/privacy/' },
  { name: 'IPQualityScore', kind: 'fraud', domains: ['ipqualityscore.com'], privacy: 'https://www.ipqualityscore.com/privacy-policy' },
  { name: 'HUMAN (PerimeterX)', kind: 'bot', domains: ['perimeterx.net', 'px-cdn.net', 'px-cloud.net', 'pxchk.net'] },
  { name: 'DataDome', kind: 'bot', domains: ['datadome.co', 'captcha-delivery.com'] },
  { name: 'Arkose Labs', kind: 'bot', domains: ['arkoselabs.com', 'funcaptcha.com'], privacy: 'https://www.arkoselabs.com/privacy-policy' },
];

export function matchVendor(host) {
  host = String(host || '').toLowerCase();
  if (!host) return null;
  return VENDORS.find(v => v.domains.some(d => host === d || host.endsWith('.' + d))) || null;
}

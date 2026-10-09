// Deletion request letters, with the extension's evidence attached. Pure functions, unit tested.
// Plain language, citing the specific provisions so the request is hard to brush off. This is
// a template, not legal advice, and the request page says so.
import { TECHNIQUES } from './techniques.js';

export const LAWS = {
  ccpa: { label: 'California (CCPA)', days: 45 },
  'us-state': { label: 'Another US state with a privacy law', days: 45 },
  gdpr: { label: 'European Union / EEA (GDPR)', days: 30 },
  uk: { label: 'United Kingdom (UK GDPR)', days: 30 },
  other: { label: 'Somewhere else', days: 30 },
};

// A tracked request: { sentAt, dueAt, law }. Early versions stored just the timestamp.
export function asRequest(r) {
  if (typeof r === 'number') return { sentAt: r, dueAt: r + 45 * 86400000, law: null };
  return r && typeof r.sentAt === 'number' ? r : null;
}

// A first guess from the time zone; the user can always change it.
export function guessLaw(timeZone = '') {
  if (timeZone === 'Europe/London') return 'uk';
  if (timeZone.startsWith('Europe/')) return 'gdpr';
  if (timeZone === 'America/Los_Angeles') return 'ccpa';
  if (/^(America\/(New_York|Chicago|Denver|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise)|Pacific\/Honolulu)/.test(timeZone)) return 'us-state';
  return 'other';
}

const fmtDate = t => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const bullets = list => list.map(x => `  - ${x}`).join('\n');

// site: { host, firstSeen, lastSeen, visits, caught[], vendors[], scripts[] }
// who:  { name, email, state }
export function buildLetter(law, site, who = {}, today = Date.now()) {
  const host = site.host;
  const techniques = (site.caught ?? []).map(id => TECHNIQUES[id]?.title).filter(Boolean);
  const vendors = site.vendors ?? [];
  const when = site.firstSeen && site.lastSeen && fmtDate(site.firstSeen) !== fmtDate(site.lastSeen)
    ? `between ${fmtDate(site.firstSeen)} and ${fmtDate(site.lastSeen)}`
    : `on ${fmtDate(site.lastSeen ?? site.firstSeen ?? today)}`;

  const evidence = [
    `When I visited ${host} ${when}, your website ran scripts that tried to identify my device, without asking me, using these techniques:`,
    bullets(techniques.length ? techniques : ['Device and browser fingerprinting']),
    site.scripts?.length ? `\nThe scripts involved included:\n${bullets(site.scripts.slice(0, 10))}` : '',
    vendors.length ? `\nThe page also loaded these third-party services: ${vendors.join(', ')}.` : '',
  ].filter(Boolean).join('\n');

  const identify = 'To find my records, you can match this request against the device and browser data your site collected during those visits. I am not providing more personal information than is needed to process this request.';
  const days = LAWS[law]?.days ?? 30;

  const asks = {
    ccpa: [
      `Under the California Consumer Privacy Act, I request that you:`,
      bullets([
        'Delete the personal information you have collected about me (Cal. Civ. Code § 1798.105). This includes device fingerprints, probabilistic identifiers and any profiles or inferences linked to them, which the CCPA defines as personal information (§ 1798.140).',
        'Stop selling or sharing my personal information (§ 1798.120). My browser also sends the Global Privacy Control signal, which you are required to honor as a valid opt-out.',
        'Direct your service providers and contractors, including those named below, to delete my information as well (§ 1798.105(c)).',
      ]),
      `Please confirm within ${days} days, as § 1798.130 requires.`,
    ],
    'us-state': [
      `Under the consumer privacy law of my state${who.state ? `, ${who.state}` : ''}, I request that you:`,
      bullets([
        'Delete the personal data you have collected about me, including device fingerprints, device identifiers and any profiles built from them.',
        'Stop selling my personal data, using it for targeted advertising, and using it for profiling. My browser also sends the Global Privacy Control signal as a universal opt-out.',
        'Pass this request on to any processors or third parties you shared my data with, including those named below.',
      ]),
      `Please respond within ${days} days, as my state's law requires.`,
    ],
    gdpr: [
      'Under the General Data Protection Regulation, I:',
      bullets([
        'Request erasure of all personal data you hold about me (Article 17), including device fingerprints and any identifiers or profiles derived from them.',
        'Object to any processing of my data for direct marketing, including profiling (Article 21(2)).',
        'Ask that you inform every recipient of my data of this erasure (Article 19), including those named below.',
      ]),
      'Fingerprinting a device requires prior consent under Article 5(3) of the ePrivacy Directive, as the European Data Protection Board confirmed in Guidelines 2/2023. I did not give it.',
      'Please respond within one month (Article 12(3)).',
    ],
    uk: [
      'Under the UK General Data Protection Regulation, I:',
      bullets([
        'Request erasure of all personal data you hold about me (Article 17), including device fingerprints and any identifiers or profiles derived from them.',
        'Object to any processing of my data for direct marketing, including profiling (Article 21(2)).',
        'Ask that you inform every recipient of my data of this erasure (Article 19), including those named below.',
      ]),
      'Accessing information on my device to fingerprint it requires my consent under regulation 6 of the Privacy and Electronic Communications Regulations (PECR). I did not give it.',
      'Please respond within one month (Article 12(3)).',
    ],
    other: [
      'I request that you:',
      bullets([
        'Delete the information you have collected about me, including device fingerprints and any profiles built from them.',
        'Stop using my data for advertising, profiling, or sale, and ask any third parties you shared it with, including those named below, to do the same.',
      ]),
      `Please confirm within ${days} days.`,
    ],
  }[law] ?? [];

  const body = [
    `To the privacy team at ${host},`,
    '',
    asks.join('\n\n'),
    '',
    evidence,
    '',
    identify,
    '',
    'Thank you,',
    who.name || '[Your name]',
    who.email || '[Your email address]',
    '',
    `Sent ${fmtDate(today)}. Evidence recorded by the What Sites See browser extension.`,
  ].join('\n');

  const subject = law === 'gdpr' || law === 'uk'
    ? `Erasure request under Article 17 GDPR: ${host}`
    : `Request to delete my personal information: ${host}`;
  return { subject, body };
}

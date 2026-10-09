// Builds a self-describing evidence record for one page visit, plus a SHA-256 digest of it.
// The digest covers a canonical serialization (keys sorted), so anyone holding the JSON can
// recompute it and confirm the record hasn't been altered since it was generated.
import { TECHNIQUES } from './techniques.js';

export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// report: from buildReport(); state: raw tab state; meta: { version, userAgent, generatedAt }
export function evidenceRecord(report, state, meta) {
  return {
    schema: 'what-sites-see/evidence@1',
    tool: { name: 'What Sites See', version: meta.version },
    generatedAt: new Date(meta.generatedAt).toISOString(),
    browser: meta.userAgent,
    page: { url: report.url, host: report.host },
    protection: report.protect ? 'on' : 'off',
    score: report.score,
    grade: report.grade,
    findings: report.items.map(i => ({
      technique: i.id,
      title: i.title,
      description: TECHNIQUES[i.id]?.vendor ? i.why : undefined,
      status: i.status,
      calls: i.count,
      sources: i.scripts.map(s => ({ url: s.url, host: s.host, thirdParty: s.thirdParty, vendor: s.vendor ?? undefined, calls: s.count ?? undefined })),
    })),
    thirdPartySites: report.thirdPartySites,
    frames: Object.values(state?.frames ?? {}).map(f => ({ url: f.url, protected: !!f.protect, contacted: f.hosts?.length ?? 0, failedToLoad: f.failed ?? [] })),
  };
}

export async function sealEvidence(record) {
  return { record, sha256: await sha256Hex(canonicalJSON(record)) };
}

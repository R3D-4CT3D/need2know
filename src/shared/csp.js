// Does a page's Content-Security-Policy let it start workers from blob: URLs? Web Worker
// coverage starts each worker from a blob: script, so it's only used where this says yes;
// elsewhere the page's workers run untouched (and unwatched) rather than breaking.
// headers: [{ name, value }] as webRequest reports them.
export function allowsBlobWorkers(headers = []) {
  const policies = headers
    .filter(h => String(h.name).toLowerCase() === 'content-security-policy')
    .flatMap(h => String(h.value).split(','));
  // Every policy must allow it. Workers fall back worker-src → child-src → script-src → default-src.
  return policies.every(policy => {
    const directives = new Map();
    for (const part of policy.split(';')) {
      const [name, ...sources] = part.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
    }
    const sources = ['worker-src', 'child-src', 'script-src', 'default-src'].map(d => directives.get(d)).find(Boolean);
    return !sources || sources.some(s => s.toLowerCase() === 'blob:');
  });
}

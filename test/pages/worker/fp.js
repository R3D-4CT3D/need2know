// A classic Web Worker that fingerprints, the way scripts do to dodge page-level protection.
// It also uses relative URLs, which must keep working when the extension wraps the worker.
importScripts('dep.js');
const first = [];
onmessage = async e => {
  first.push(e.data);
  postMessage(await fingerprint({ dep: self.depLoaded === true, firstMessage: first[0] }));
};

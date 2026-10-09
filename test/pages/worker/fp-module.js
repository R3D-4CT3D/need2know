// The same fingerprinting as fp.js, as a module worker with a relative import.
import './dep.js';
const first = [];
onmessage = async e => {
  first.push(e.data);
  postMessage(await self.fingerprint({ dep: self.depLoaded === true, firstMessage: first[0] }));
};

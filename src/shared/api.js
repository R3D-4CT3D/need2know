// Firefox exposes promise-based `browser.*`; Chromium browsers (Chrome, Edge, Brave, Opera)
// expose `chrome.*`, which also returns promises in Manifest V3. Either works for our calls.
export const api = globalThis.browser ?? globalThis.chrome;

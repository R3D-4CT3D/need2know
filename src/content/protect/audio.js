// Protection: audio noise. Inaudible changes to rendered sound.
// Uses the helpers core.js shares; see core.js for how the files fit together.
(() => {
  'use strict';
  const k = window.__wssProtect;
  if (!k) return;
  const { P, apply, seedNow, mix, override, adjust } = k;

  // Adds noise around ten-millionths of the signal: inaudible, but it changes the audio hash.
  const AB = P('AudioBuffer');
  const nativeGetChannelData = AB && AB.getChannelData;
  const noised = new WeakMap(); // AudioBuffer -> Set of channels already noised
  function noiseChannel(buffer, ch) {
    let done = noised.get(buffer);
    if (!done) noised.set(buffer, done = new Set());
    if (done.has(ch)) return;
    done.add(ch);
    const data = apply(nativeGetChannelData, buffer, [ch]);
    if (data.length > 500000) return; // long recordings: leave them alone
    const s = seedNow();
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0) continue; // silence stays silent
      const h = mix(s ^ mix(i ^ (ch << 24)) ^ Math.round(data[i] * 1e6));
      data[i] += (h / 4294967296 - 0.5) * 2e-7;
    }
  }
  override(AB, 'getChannelData', (native, self, args) => { try { noiseChannel(self, args[0] >>> 0); } catch (_) {} return apply(native, self, args); });
  override(AB, 'copyFromChannel', (native, self, args) => { try { noiseChannel(self, args[1] >>> 0); } catch (_) {} return apply(native, self, args); });
  adjust(P('AnalyserNode'), 'getFloatFrequencyData', (ret, [arr]) => {
    const s = seedNow();
    for (let i = 0; i < arr.length; i++) arr[i] += (mix(s ^ i) / 4294967296 - 0.5) * 1e-4;
    return ret;
  });
})();

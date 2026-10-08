// A deliberately nosy "third-party" script for manual testing. It calls every API the
// extension hooks, in roughly the way commercial fingerprinting libraries do.
(async () => {
  const done = [];

  // Canvas: draw text, read it back.
  const c = document.createElement('canvas'); c.width = 240; c.height = 60;
  const x = c.getContext('2d');
  x.font = '16px Arial'; x.fillStyle = '#069'; x.fillText('Cwm fjordbank glyphs vext quiz', 2, 20);
  c.toDataURL(); done.push('canvas');

  // Fonts: measure the same string in many fonts against fallback families.
  const m = document.createElement('canvas').getContext('2d');
  for (const f of ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Menlo', 'Monaco', 'Helvetica Neue', 'Segoe UI',
    'Ubuntu', 'Roboto', 'Fira Code', 'JetBrains Mono', 'Garamond', 'Futura', 'Optima', 'Papyrus'])
    for (const base of ['monospace', 'serif']) { m.font = `72px "${f}", ${base}`; m.measureText('mmmmmmmmlli'); }
  done.push('fonts');

  // WebGL: the unmasked GPU name.
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) { gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL); done.push('webgl'); }

  // Audio: render a tone offline.
  try {
    const ac = new OfflineAudioContext(1, 5000, 44100);
    const o = ac.createOscillator(); o.connect(ac.destination); o.start(0);
    ac.startRendering().catch(() => {}); done.push('audio');
  } catch {}

  // Hardware sweep.
  void [navigator.hardwareConcurrency, navigator.deviceMemory, navigator.platform, navigator.languages,
    navigator.plugins, navigator.maxTouchPoints, navigator.vendor, navigator.doNotTrack, navigator.webdriver,
    navigator.pdfViewerEnabled, navigator.cookieEnabled, screen.width, screen.height, screen.colorDepth, screen.availWidth];
  done.push('sweep');

  // One-shot lookups (some only exist in Chromium).
  navigator.getBattery?.().catch(() => {});
  navigator.mediaDevices?.enumerateDevices?.().catch(() => {});
  window.speechSynthesis?.getVoices();
  navigator.keyboard?.getLayoutMap?.().catch(() => {});
  navigator.storage?.estimate?.().catch(() => {});
  navigator.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']).catch(() => {});
  done.push('lookups');

  // WebRTC local-IP trick.
  try { const pc = new RTCPeerConnection(); pc.createDataChannel(''); await pc.createOffer(); pc.close(); done.push('webrtc'); } catch {}

  // Page-wide keystroke listener.
  document.addEventListener('keydown', () => {}); done.push('keys');

  const s = document.getElementById('status');
  if (s) s.textContent = 'Tracker ran: ' + done.join(', ');
})();

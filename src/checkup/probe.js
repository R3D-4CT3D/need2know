// Measures what any website could read about this browser, then reports to the Checkup page.
// Loaded twice: plainly (probe.html), and after the protection files (probe-protected.html), so the
// page can show the same measurements with and without protection side by side.
(async () => {
  const hash = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  const timeout = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
  const d = {};

  const c = document.createElement('canvas'); c.width = 240; c.height = 60;
  const x = c.getContext('2d');
  x.fillStyle = '#f60'; x.fillRect(120, 1, 62, 20);
  x.fillStyle = '#069'; x.font = '15px Arial'; x.fillText('Cwm fjordbank glyphs vext quiz', 2, 15);
  x.fillStyle = 'rgba(102,204,0,0.7)'; x.font = '18px Georgia'; x.fillText('Cwm fjordbank glyphs vext quiz', 4, 36);
  d.canvas = await hash(c.toDataURL());

  try {
    const ac = new OfflineAudioContext(1, 5000, 44100);
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000;
    const comp = ac.createDynamicsCompressor();
    o.connect(comp); comp.connect(ac.destination); o.start(0);
    const buf = await timeout(ac.startRendering(), 1500);
    if (buf) { const data = buf.getChannelData(0); let s = 0; for (let i = 4500; i < 5000; i++) s += Math.abs(data[i]); d.audio = await hash(s.toFixed(12)); }
  } catch { /* no audio */ }

  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    d.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null;
  } catch { /* no WebGL */ }

  d.cores = navigator.hardwareConcurrency ?? null;
  d.memory = navigator.deviceMemory ?? null;
  const voices = speechSynthesis?.getVoices() ?? [];
  d.voices = voices.length;
  d.keyboard = await timeout(navigator.keyboard?.getLayoutMap?.().then(() => 'readable', () => 'blocked'), 800) ?? 'not supported';
  const hints = await timeout(navigator.userAgentData?.getHighEntropyValues?.(['platformVersion', 'model', 'architecture', 'bitness']), 800);
  d.hints = hints ? [
    hints.platform && `${hints.platform}${hints.platformVersion ? ` version ${hints.platformVersion}` : ''}`,
    hints.architecture && `${hints.architecture}${hints.bitness ? ` ${hints.bitness}-bit` : ''} processor`,
    hints.model && `model ${hints.model}`,
  ].filter(Boolean).join(', ') : 'not shared by this browser';
  d.screen = `${screen.width}×${screen.height}`;
  d.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  d.language = navigator.languages?.join(', ') ?? navigator.language;

  // Installed fonts, measured the way fingerprinters do.
  const fonts = ['Calibri', 'Cambria', 'Consolas', 'Segoe UI', 'Aptos', 'Menlo', 'Monaco', 'Helvetica Neue', 'Avenir Next', 'Futura',
    'Ubuntu', 'Cantarell', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Roboto', 'Fira Code', 'JetBrains Mono', 'Cascadia Code',
    'Source Code Pro', 'Garamond', 'Century Gothic', 'Franklin Gothic Medium', 'Rockwell', 'Minion Pro', 'Myriad Pro', 'Papyrus'];
  const m = document.createElement('canvas').getContext('2d');
  const width = f => { m.font = `72px ${f}`; return m.measureText('mmmmmmmmmmlli').width; };
  const bases = ['monospace', 'serif', 'sans-serif'].map(b => [b, width(b)]);
  d.fonts = fonts.filter(f => bases.some(([b, w]) => width(`"${f}", ${b}`) !== w)).length;

  parent.postMessage({ type: 'probe', id: new URLSearchParams(location.search).get('id'), data: d }, location.origin);
})();

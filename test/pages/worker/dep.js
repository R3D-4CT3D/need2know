self.depLoaded = true;
// Shared by the classic and module test workers.
self.fingerprint = async extra => {
  const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  const c = new OffscreenCanvas(220, 50);
  const x = c.getContext('2d');
  x.fillStyle = '#f60'; x.fillRect(100, 1, 60, 20);
  x.font = '15px Arial'; x.fillStyle = '#069'; x.fillText('Cwm fjordbank glyphs vext quiz', 2, 15);
  const canvas = await hex(JSON.stringify([...x.getImageData(0, 0, 220, 50).data]));
  const gl = new OffscreenCanvas(1, 1).getContext('webgl');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const fetchOk = await fetch('../headers').then(r => r.ok, () => false);
  return { ...extra, canvas, cores: navigator.hardwareConcurrency, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, location: String(self.location.href), fetchOk };
};

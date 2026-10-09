// Third-party script (served from 127.0.0.1:8081) that tries to dodge the extension's hooks.
// The variant comes from the page's ?v= parameter. Each one writes "done" to #status when finished.
(() => {
  const variant = new URLSearchParams(location.search).get('v');
  const status = t => { const s = document.getElementById('status'); if (s) s.textContent = t; };

  // Canvas fingerprint using whatever document (and therefore whatever realm) it's given.
  const canvasFp = d => {
    const c = d.createElement('canvas'); c.width = 200; c.height = 40;
    const x = c.getContext('2d'); x.font = '14px Arial'; x.fillText('escape test', 2, 20);
    return c.toDataURL();
  };
  const blankFrame = () => {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    document.body.appendChild(f);
    return f;
  };
  // Inline script for blob:/data: frames: runs entirely inside the child document.
  const childHtml = '<!doctype html><body><script>' +
    'var c=document.createElement("canvas");c.width=200;c.height=40;' +
    'var x=c.getContext("2d");x.font="14px Arial";x.fillText("escape test",2,20);c.toDataURL();' +
    '<\/script></body>';

  const variants = {
    iframe() { canvasFp(blankFrame().contentWindow.document); },

    frames() { blankFrame(); canvasFp(window.frames[window.frames.length - 1].document); },

    srcdoc: () => new Promise(resolve => {
      const f = document.createElement('iframe');
      f.style.display = 'none';
      f.srcdoc = '<!doctype html><body></body>';
      f.onload = () => { canvasFp(f.contentWindow.document); resolve(); };
      document.body.appendChild(f);
    }),

    'dom-fonts'() {
      const fonts = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Menlo', 'Monaco', 'Helvetica Neue', 'Segoe UI',
        'Ubuntu', 'Roboto', 'Fira Code', 'JetBrains Mono', 'Garamond', 'Futura', 'Optima', 'Papyrus'];
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;left:-9999px;font-size:72px';
      document.body.appendChild(box);
      for (const f of fonts) for (const base of ['monospace', 'serif']) {
        const s = document.createElement('span');
        s.textContent = 'mmmmmmmmmmlli';
        s.style.fontFamily = `"${f}", ${base}`;
        box.appendChild(s);
        void s.offsetWidth; void s.offsetHeight;
      }
      box.remove();
    },

    blob: () => new Promise(resolve => {
      const f = blankFrame();
      f.onload = resolve;
      f.src = URL.createObjectURL(new Blob([childHtml], { type: 'text/html' }));
    }),

    data: () => new Promise(resolve => {
      const f = blankFrame();
      f.onload = resolve;
      f.src = 'data:text/html,' + encodeURIComponent(childHtml);
    }),

    fingerprintjs: () => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'http://127.0.0.1:8081/vendor/fingerprintjs.js';
      s.onload = () => window.FingerprintJS.load().then(fp => fp.get()).then(r => { status('visitorId ' + r.visitorId); resolve(); }, reject);
      s.onerror = reject;
      document.head.appendChild(s);
    }),
  };

  if (!variants[variant]) return;
  Promise.resolve().then(variants[variant])
    .then(() => { const s = document.getElementById('status'); s.dataset.done = '1'; if (!s.textContent) status('done'); })
    .catch(e => status('error: ' + e.message));
})();

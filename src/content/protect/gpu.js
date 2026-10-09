// Protection: generic graphics chip. Sites see the GPU brand, not the exact model, through both
// WebGL and WebGPU.
// Uses the helpers core.js shares; see core.js for how the files fit together.
(() => {
  'use strict';
  const k = window.__wssProtect;
  if (!k) return;
  const { P, adjust, overrideGetter, enable } = k;
  enable('gpu');

  const VENDOR_BUCKETS = [
    ['NVIDIA', /nvidia|geforce|quadro|rtx|gtx/i], ['AMD', /\bamd\b|radeon|\bati\b/i], ['Intel', /intel/i],
    ['Apple', /apple/i], ['Qualcomm', /qualcomm|adreno/i], ['ARM', /\bmali\b|\barm\b/i], ['Google', /swiftshader|google/i],
  ];
  const bucket = s => (VENDOR_BUCKETS.find(([, re]) => re.test(s)) || ['Generic'])[0];
  // Keep the format (so nothing looks odd), drop the exact model: "ANGLE (NVIDIA, NVIDIA GeForce
  // RTX 3070 (0x2484) Direct3D11…, D3D11)" becomes "ANGLE (NVIDIA, NVIDIA Graphics, D3D11)".
  const genericRenderer = r => {
    const s = String(r), b = bucket(s);
    const angle = s.match(/^ANGLE \(.*,\s*([^,]*)\)$/);
    return angle ? `ANGLE (${b}, ${b} Graphics, ${angle[1]})` : `${b} Graphics`;
  };
  const genericVendor = v => /^Google Inc\. \(/.test(String(v)) ? `Google Inc. (${bucket(String(v).slice(12))})` : bucket(String(v));
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    adjust(P(name), 'getParameter', (v, [p]) => {
      if (p === 0x9246 || (p === 0x1F01 && typeof v === 'string' && !/^WebKit/.test(v))) return genericRenderer(v);
      if (p === 0x9245) return genericVendor(v);
      return v;
    });
  }

  // WebGPU's adapter info: keep the vendor (the brand), blank the chip family and model.
  // Capability limits and subgroup sizes are left alone: WebGPU programs depend on them.
  for (const name of ['architecture', 'device', 'description']) overrideGetter(P('GPUAdapterInfo'), name, () => '');
})();

// Draws the eye logo as PNGs with no image libraries: rasterize with 4x4 supersampling,
// then hand-assemble the PNG chunks. Chrome requires PNG toolbar icons (no SVG).
// Usage: node scripts/make-icons.mjs
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/icons/', import.meta.url));
const INK = [26, 32, 28], PAPER = [239, 242, 236], STAMP = [184, 57, 42];

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => { let c = ~0; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function draw(size) {
  const c = size / 2, rx = size * 0.48, ry = size * 0.33, stroke = Math.max(1.3, size * 0.08), pupil = size * 0.17;
  const inEllipse = (x, y, a, b) => ((x - c) / a) ** 2 + ((y - c) / b) ** 2 <= 1;
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + 0.5) / SS, Y = y + (sy + 0.5) / SS;
      let col = null;
      if (Math.hypot(X - c, Y - c) <= pupil) col = STAMP;
      else if (inEllipse(X, Y, rx - stroke, ry - stroke)) col = PAPER;
      else if (inEllipse(X, Y, rx, ry)) col = INK;
      if (col) { r += col[0]; g += col[1]; b += col[2]; a++; }
    }
    const i = (y * size + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = Math.round(255 * a / (SS * SS)); }
  }
  return png(size, px);
}

for (const size of [16, 32, 48, 128]) {
  await writeFile(`${out}icon-${size}.png`, draw(size));
  console.log(`wrote src/icons/icon-${size}.png`);
}

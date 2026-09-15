// Erzeugt die PNG-Icons ohne externe Abhängigkeiten (nur node:zlib).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function draw(size, { padding = 0 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const radius = padding ? 0 : 112 * s;  // maskable: randlos, Inhalt eingerückt
  const inset = padding * size;
  const cardInset = inset;
  const scale = (1 - 2 * padding);

  const cards = [
    [96, 120, 136, 104, 0.95],
    [256, 120, 160, 152, 0.65],
    [96, 256, 136, 136, 0.65],
    [256, 304, 160, 88, 0.95],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Hintergrund mit abgerundeten Ecken
      const inRounded = insideRounded(x, y, size, size, radius);
      if (!inRounded) { buf[i + 3] = 0; continue; }
      const t = (x / size + y / size) / 2;
      const [r, g, b] = mix([59, 123, 255], [124, 92, 240], t);
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;

      // Karten
      for (const [cx, cy, cw, ch, alpha] of cards) {
        const X = (cx * s) * scale + cardInset;
        const Y = (cy * s) * scale + cardInset;
        const W = cw * s * scale;
        const H = ch * s * scale;
        if (x >= X && x < X + W && y >= Y && y < Y + H) {
          if (!insideRounded(x - X, y - Y, W, H, 26 * s * scale)) continue;
          buf[i] = Math.round(buf[i] + (255 - buf[i]) * alpha);
          buf[i + 1] = Math.round(buf[i + 1] + (255 - buf[i + 1]) * alpha);
          buf[i + 2] = Math.round(buf[i + 2] + (255 - buf[i + 2]) * alpha);
        }
      }
    }
  }
  return png(size, size, buf);
}

function insideRounded(x, y, w, h, r) {
  if (r <= 0) return x >= 0 && y >= 0 && x < w && y < h;
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r;
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const out = (name, data) => {
  writeFileSync(new URL(`../icons/${name}`, import.meta.url), data);
  console.log(`icons/${name} (${data.length} Bytes)`);
};
out('icon-192.png', draw(192));
out('icon-512.png', draw(512));
out('apple-touch-icon.png', draw(180));
out('icon-maskable-512.png', draw(512, { padding: 0.12 }));

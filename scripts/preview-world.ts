// Dev helper: renders biome maps to PNG for visual sanity checks.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Rng } from '../src/engine/rng';
import { generateWorld, DEFAULT_WORLDGEN } from '../src/engine/world/worldgen';
import { BIOMES } from '../src/engine/world/biomes';

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = process.argv[2] ?? '.';
const configs: [string, any][] = [['alpha', DEFAULT_WORLDGEN], ['gamma', DEFAULT_WORLDGEN], ['isles', { ...DEFAULT_WORLDGEN, islands: 6, landFraction: 0.3 }]];
for (const [seed, cfg] of configs) {
  const t0 = performance.now();
  const w = generateWorld(cfg, new Rng(seed));
  const ms = performance.now() - t0;
  const S = 3;
  const rgb = new Uint8Array(w.width * S * w.height * S * 3);
  for (let y = 0; y < w.height * S; y++) for (let x = 0; x < w.width * S; x++) {
    const i = w.idx((x / S) | 0, (y / S) | 0);
    let [r, g, b] = BIOMES[w.biome[i]].color;
    if (w.river[i]) { r = 50; g = 110; b = 160; }
    const o = (y * w.width * S + x) * 3; rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  }
  writeFileSync(`${out}/world-${seed}.png`, png(w.width * S, w.height * S, rgb));
  console.log(seed, `${ms.toFixed(0)}ms`, 'landmasses', w.landmasses.length, w.landmasses.slice(0, 4).map((l) => `${l.name}(${l.size})`).join(', '));
}

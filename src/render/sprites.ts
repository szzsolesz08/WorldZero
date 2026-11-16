/** Procedurally drawn, cached sprites for creatures, clouds and lights. */

export const SPRITE = 64;
const HUE_STEPS = 36;

export function bodyType(diet: number, shape: number): number {
  if (diet > 0.6) return 3; // predator
  if (diet > 0.35) return 2; // omnivore
  return shape < 0.5 ? 0 : 1; // grazer / browser
}

const cache = new Map<string, HTMLCanvasElement>();
const colorCache = new Map<number, string>();

export function hueColor(hue: number, sat: number, light = 60): string {
  const key = (Math.round(hue * HUE_STEPS) % HUE_STEPS) * 1000 + Math.round(sat * 3) * 100 + light;
  let c = colorCache.get(key);
  if (!c) {
    c = `hsl(${Math.round((Math.round(hue * HUE_STEPS) / HUE_STEPS) * 360)}, ${Math.round(40 + Math.round(sat * 3) / 3 * 45)}%, ${light}%)`;
    colorCache.set(key, c);
  }
  return c;
}

export function creatureSprite(hue: number, sat: number, pattern: number, diet: number, shape: number): HTMLCanvasElement {
  const hb = Math.round(hue * HUE_STEPS) % HUE_STEPS;
  const sb = Math.round(sat * 3);
  const pb = pattern < 0.33 ? 0 : pattern < 0.66 ? 1 : 2;
  const bt = bodyType(diet, shape);
  const key = `${bt}-${hb}-${sb}-${pb}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d')!;
  const H = (hb / HUE_STEPS) * 360;
  const S = 40 + (sb / 3) * 45;
  const base = `hsl(${H}, ${S}%, 58%)`;
  const dark = `hsl(${H}, ${S}%, 30%)`;
  const light = `hsl(${H}, ${Math.min(100, S + 10)}%, 74%)`;
  g.translate(SPRITE / 2, SPRITE / 2);

  // Soft drop shadow.
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.ellipse(2, 4, 22, 11, 0, 0, Math.PI * 2);
  g.fill();

  const body = new Path2D();
  const head = new Path2D();
  const tail = new Path2D();
  switch (bt) {
    case 0: // grazer: compact oval, round head
      body.ellipse(-3, 0, 17, 11, 0, 0, Math.PI * 2);
      head.ellipse(15, 0, 8, 7, 0, 0, Math.PI * 2);
      tail.ellipse(-20, 0, 4, 3, 0, 0, Math.PI * 2);
      break;
    case 1: // browser: bulky body, long neck
      body.ellipse(-5, 0, 18, 13, 0, 0, Math.PI * 2);
      head.moveTo(8, -5); head.lineTo(22, -4); head.quadraticCurveTo(28, 0, 22, 4); head.lineTo(8, 5); head.closePath();
      tail.ellipse(-23, 0, 4, 3, 0, 0, Math.PI * 2);
      break;
    case 2: // omnivore: rounded, snout and bushy tail
      body.ellipse(-2, 0, 15, 11, 0, 0, Math.PI * 2);
      head.moveTo(9, -7); head.quadraticCurveTo(24, -5, 26, 0); head.quadraticCurveTo(24, 5, 9, 7); head.closePath();
      tail.ellipse(-20, 2, 9, 4, 0.3, 0, Math.PI * 2);
      break;
    default: // predator: sleek, wedge head, long tail
      body.moveTo(-18, -8); body.quadraticCurveTo(4, -12, 12, -6); body.lineTo(12, 6); body.quadraticCurveTo(4, 12, -18, 8); body.closePath();
      head.moveTo(10, -8); head.lineTo(29, 0); head.lineTo(10, 8); head.closePath();
      tail.moveTo(-17, -3); tail.quadraticCurveTo(-30, -6, -31, 2); tail.quadraticCurveTo(-26, 1, -17, 3); tail.closePath();
  }
  g.fillStyle = dark;
  g.fill(tail);
  g.fillStyle = base;
  g.fill(body);
  g.fill(head);

  // Pattern clipped to body.
  if (pb > 0) {
    g.save();
    g.clip(body);
    g.fillStyle = dark;
    g.globalAlpha = 0.55;
    if (pb === 1) {
      for (const [x, y, r] of [[-10, -4, 3.2], [-2, 4, 2.8], [4, -3, 2.5], [-14, 4, 2.4], [-5, -7, 2.2]]) {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    } else {
      for (let x = -18; x < 14; x += 7) g.fillRect(x, -14, 3, 28);
    }
    g.restore();
  }
  // Highlight on the back.
  g.save();
  g.clip(body);
  g.fillStyle = light;
  g.globalAlpha = 0.35;
  g.beginPath();
  g.ellipse(-3, -6, 13, 4, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Outline.
  g.strokeStyle = 'rgba(8,10,16,0.55)';
  g.lineWidth = 1.6;
  g.stroke(body);
  g.stroke(head);

  // Eyes.
  const ex = bt === 3 ? 18 : bt === 1 ? 20 : bt === 2 ? 17 : 17;
  for (const ey of [-3.2, 3.2]) {
    g.fillStyle = bt === 3 ? '#ffd76a' : '#f4f7fb';
    g.beginPath(); g.arc(ex, ey, 2.1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0d12';
    g.beginPath(); g.arc(ex + 0.7, ey, 1.1, 0, Math.PI * 2); g.fill();
  }
  if (bt === 0 || bt === 1) {
    // Ears.
    g.fillStyle = dark;
    g.beginPath(); g.ellipse(bt === 1 ? 10 : 11, -7, 3.5, 2, -0.6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(bt === 1 ? 10 : 11, 7, 3.5, 2, 0.6, 0, Math.PI * 2); g.fill();
  }
  cache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- Clouds & lights

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, s: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

const cloudCache: HTMLCanvasElement[][] = [];

/** variant 0..2, tone 0 = white, 1 = grey, 2 = storm */
export function cloudSprite(variant: number, tone: number): HTMLCanvasElement {
  if (!cloudCache[variant]) cloudCache[variant] = [];
  let c = cloudCache[variant][tone];
  if (c) return c;
  const S = 192;
  c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const col = tone === 0 ? [246, 248, 252] : tone === 1 ? [190, 198, 210] : [96, 102, 118];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      let n = 0, amp = 0.5, f = 3;
      for (let o = 0; o < 5; o++) { n += noise(x / S * f, y / S * f, variant * 17 + o) * amp; amp *= 0.5; f *= 2; }
      const falloff = Math.max(0, 1 - d * d);
      const a = Math.max(0, Math.min(1, (n - 0.35) * 2.4)) * falloff;
      const o = (y * S + x) * 4;
      const shadeK = 0.82 + 0.18 * (1 - dy * 0.5) * n;
      img.data[o] = col[0] * shadeK;
      img.data[o + 1] = col[1] * shadeK;
      img.data[o + 2] = col[2] * shadeK;
      img.data[o + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  cloudCache[variant][tone] = c;
  return c;
}

const glowCache = new Map<string, HTMLCanvasElement>();

export function glowSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const key = `${r},${g},${b}`;
  let c = glowCache.get(key);
  if (c) return c;
  const S = 128;
  c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.25, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.15)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, S, S);
  glowCache.set(key, c);
  return c;
}

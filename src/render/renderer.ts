import type { SimClient } from '../client/simClient';
import type { FramePayload, LayersPayload, TerrainPayload } from '../worker/protocol';
import type { SettlementView, WeatherView } from '../engine/types';
import type { Fx } from '../engine/simulation';
import { FRAME_STRIDE, FLAG } from '../engine/frame';
import { Camera } from './camera';
import { paintTerrain } from './terrainPainter';
import { creatureSprite, cloudSprite, glowSprite, hueColor, SPRITE } from './sprites';

interface Disp {
  x: number; y: number; h: number;
  tx: number; ty: number; th: number;
  size: number; hue: number; sat: number; pat: number; shape: number; diet: number; flags: number; tribeHue: number;
  seen: number;
}

interface ActiveFx extends Fx {
  start: number;
  bolt?: [number, number][];
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; kind: 0 | 1 | 2 }

export interface Overlays { territory: boolean; vegetation: boolean; weather: boolean; labels: boolean }

export interface PickResult { kind: 'creature' | 'settlement' | 'none'; id: number; tribeId?: number }

function h32(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export class WorldRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera = new Camera();
  dpr = 1;
  client: SimClient;
  overlays: Overlays = { territory: true, vegetation: true, weather: true, labels: true };
  selectedId: number | null = null;
  followSelected = false;
  hoverId: number | null = null;
  mouse: { x: number; y: number } | null = null;
  brushRadius = 0;
  brushColor = 'rgba(127,224,196,0.8)';

  private terrainCanvas = document.createElement('canvas');
  private terrainVersion = -1;
  private terrain: TerrainPayload | null = null;
  private vegCanvas = document.createElement('canvas');
  private snowCanvas = document.createElement('canvas');
  private terrCanvas = document.createElement('canvas');
  private vegHi = document.createElement('canvas');
  private snowHi = document.createElement('canvas');
  private terrHi = document.createElement('canvas');
  private borders: { color: string; path: Path2D }[] = [];
  private terrKey = '';
  private layersRef: LayersPayload | null = null;
  private snowKey = '';
  private fires: number[] = [];
  private farms: number[] = [];
  private waterSample: Int32Array = new Int32Array(0);
  private disp = new Map<number, Disp>();
  private lastFrame: FramePayload | null = null;
  private frameSeq = 0;
  private fx: ActiveFx[] = [];
  private particles: Particle[] = [];
  private trail: [number, number][] = [];
  private trailT = 0;
  private shake = 0;
  private flash = 0;
  private raf = 0;
  private lastT = performance.now();
  private vignette: CanvasGradient | null = null;
  private running = false;
  onFrameRendered: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, client: SimClient) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.client = client;
  }

  start(): void {
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.render(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const first = this.camera.viewW === 800 && this.camera.viewH === 600;
    const narrow = w <= 720;
    this.camera.insetTop = narrow ? 48 : 52;
    this.camera.insetBottom = narrow ? 52 : 0;
    this.camera.resize(w, h);
    if (first && this.terrain) this.camera.fit();
    const g = this.ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2,4,10,0.38)');
    this.vignette = g;
  }

  resetWorld(): void {
    this.terrainVersion = -1;
    this.terrain = null;
    this.disp.clear();
    this.fx = [];
    this.particles = [];
    this.trail = [];
    this.layersRef = null;
    this.snowKey = '';
  }

  // ---------------------------------------------------------------- Data sync

  private syncTerrain(): void {
    const t = this.client.terrain;
    if (!t || t.version === this.terrainVersion && t === this.terrain) return;
    const firstWorld = this.terrain === null || this.terrain.width !== t.width || this.terrain.height !== t.height;
    this.terrain = t;
    this.terrainVersion = t.version;
    paintTerrain(t, this.terrainCanvas);
    this.camera.setWorld(t.width, t.height);
    if (firstWorld) this.camera.fit();
    for (const c of [this.vegCanvas, this.snowCanvas, this.terrCanvas]) { c.width = t.width; c.height = t.height; }
    // Random sample of water tiles for animated glints.
    const water: number[] = [];
    for (let i = 0; i < t.biome.length; i++) if (t.biome[i] <= 2) water.push(i);
    const n = Math.min(2600, water.length);
    this.waterSample = new Int32Array(n);
    for (let k = 0; k < n; k++) this.waterSample[k] = water[Math.floor(h32(k * 7919 + t.version) * water.length)];
    this.snowKey = '';
    this.layersRef = null;
  }

  private syncLayers(season: number): void {
    const L = this.client.layers, t = this.terrain;
    if (!L || !t || L === this.layersRef || L.veg.length !== t.biome.length) return;
    this.layersRef = L;
    const W = t.width, H = t.height;
    // Vegetation: dry/overgrazed tint, lushness, autumn colours.
    const vctx = this.vegCanvas.getContext('2d')!;
    const vimg = vctx.createImageData(W, H);
    const d = vimg.data;
    for (let i = 0; i < W * H; i++) {
      const b = t.biome[i];
      if (b <= 3 || b === 14 || b === 16) continue;
      const ratio = L.veg[i] / 200;
      let r = 0, g = 0, bl = 0, a = 0;
      const dry = Math.max(0, Math.min(0.55, (0.55 - ratio) * 0.95));
      if (dry > 0) { r = 128; g = 102; bl = 62; a = dry; }
      else {
        const lush = Math.max(0, Math.min(0.14, (ratio - 0.75) * 0.4));
        r = 70; g = 150; bl = 60; a = lush;
      }
      if (season === 2 && (b === 9 || b === 8 || b === 7) && ratio > 0.3) {
        const k = b === 9 ? 0.38 : 0.18;
        r = r * (1 - k) + 206 * k; g = g * (1 - k) + 118 * k; bl = bl * (1 - k) + 40 * k; a = Math.max(a, k);
      } else if (season === 0 && ratio > 0.5 && (b === 7 || b === 6)) {
        r = 120; g = 190; bl = 80; a = Math.max(a, 0.1);
      }
      const o = i * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = a * 255;
    }
    vctx.putImageData(vimg, 0, 0);
    // Territory with brighter borders.
    const tctx = this.terrCanvas.getContext('2d')!;
    const timg = tctx.createImageData(W, H);
    const td = timg.data;
    const rgbCache = new Map<number, [number, number, number]>();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const own = L.territory[i];
        if (own < 0) continue;
        let rgb = rgbCache.get(own);
        if (!rgb) { rgb = hslToRgb(L.tribeHues[own] ?? 0, 0.75, 0.6); rgbCache.set(own, rgb); }
        const o = i * 4;
        td[o] = rgb[0]; td[o + 1] = rgb[1]; td[o + 2] = rgb[2]; td[o + 3] = 34;
      }
    }
    tctx.putImageData(timg, 0, 0);
    soften(this.terrCanvas, this.terrHi, 2);
    soften(this.vegCanvas, this.vegHi, 1.6);
    // Smooth vector borders, rebuilt only when ownership changes.
    let hsh = 0;
    for (let i = 0; i < L.territory.length; i += 3) hsh = (Math.imul(hsh, 31) + L.territory[i] + 2) | 0;
    const key = `${hsh}:${Object.keys(L.tribeHues).join(',')}`;
    if (key !== this.terrKey) {
      this.terrKey = key;
      this.borders = territoryBorders(L.territory, W, H, L.tribeHues);
    }
    this.fires = [];
    this.farms = [];
    for (let i = 0; i < W * H; i++) {
      if (L.fire[i] > 0) this.fires.push(i);
      if (L.farm[i]) this.farms.push(i);
    }
  }

  private syncSnow(f: FramePayload): void {
    const t = this.terrain;
    if (!t) return;
    const yearPhase = (f.env.tick % 4800) / 4800;
    const key = `${Math.round(yearPhase * 60)}:${Math.round(f.env.globalTemp * 4)}`;
    if (key === this.snowKey) return;
    this.snowKey = key;
    const W = t.width, H = t.height;
    const sctx = this.snowCanvas.getContext('2d')!;
    const img = sctx.createImageData(W, H);
    const d = img.data;
    const seasonSin = Math.sin(2 * Math.PI * (yearPhase - 0.125));
    for (let y = 0; y < H; y++) {
      const lat = Math.abs(y / H - 0.5) * 2;
      const seasonal = (4 + 12 * lat) * seasonSin;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const temp = t.baseTemp[i] + seasonal + f.env.globalTemp;
        const b = t.biome[i];
        const o = i * 4;
        if (b <= 3) {
          if (temp < -6) { d[o] = 214; d[o + 1] = 228; d[o + 2] = 240; d[o + 3] = Math.min(200, (-6 - temp) * 40); }
        } else if (temp < 1) {
          d[o] = 240; d[o + 1] = 245; d[o + 2] = 252; d[o + 3] = Math.min(225, (1 - temp) * 46);
        }
      }
    }
    sctx.putImageData(img, 0, 0);
    soften(this.snowCanvas, this.snowHi, 1.4);
  }

  private syncFrame(now: number): void {
    const f = this.client.frame;
    if (!f || f === this.lastFrame) return;
    this.lastFrame = f;
    this.frameSeq++;
    const buf = f.buf;
    for (let k = 0; k < f.count; k++) {
      const o = k * FRAME_STRIDE;
      const id = buf[o];
      let d = this.disp.get(id);
      if (!d) {
        d = { x: buf[o + 1], y: buf[o + 2], h: buf[o + 3], tx: 0, ty: 0, th: 0, size: 0, hue: 0, sat: 0, pat: 0, shape: 0, diet: 0, flags: 0, tribeHue: -1, seen: 0 };
        this.disp.set(id, d);
      }
      d.tx = buf[o + 1]; d.ty = buf[o + 2]; d.th = buf[o + 3];
      d.size = buf[o + 4]; d.hue = buf[o + 5]; d.sat = buf[o + 6]; d.pat = buf[o + 7]; d.shape = buf[o + 8];
      d.diet = buf[o + 9]; d.flags = buf[o + 10]; d.tribeHue = buf[o + 11];
      d.seen = this.frameSeq;
      if (Math.abs(d.tx - d.x) + Math.abs(d.ty - d.y) > 4) { d.x = d.tx; d.y = d.ty; d.h = d.th; }
    }
    for (const [id, d] of this.disp) if (d.seen !== this.frameSeq) this.disp.delete(id);
    for (const e of f.fx) this.addFx(e, now);
  }

  private addFx(e: Fx, now: number): void {
    const a: ActiveFx = { ...e, start: now };
    if (e.kind === 'lightning') {
      const pts: [number, number][] = [];
      let x = e.x + (Math.random() - 0.5) * 6, y = e.y - 30;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push([x, y]);
        x = e.x + (x - e.x) * (1 - t) + (Math.random() - 0.5) * 1.6;
        y = e.y - 30 * (1 - t);
      }
      pts.push([e.x, e.y]);
      a.bolt = pts;
      this.flash = Math.max(this.flash, 0.5);
    }
    if (e.kind === 'quake') this.shake = Math.max(this.shake, Math.min(14, 4 + e.r * 0.4));
    if (e.kind === 'meteor') this.shake = Math.max(this.shake, 6);
    this.fx.push(a);
    if (this.fx.length > 60) this.fx.shift();
  }

  // ---------------------------------------------------------------- Picking

  pick(sx: number, sy: number): PickResult {
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const r = Math.max(0.7, 12 / this.camera.zoom);
    let best = -1, bd = r * r;
    for (const [id, d] of this.disp) {
      const dd = (d.x - wx) ** 2 + (d.y - wy) ** 2;
      if (dd < bd) { bd = dd; best = id; }
    }
    if (best >= 0) return { kind: 'creature', id: best };
    const f = this.lastFrame;
    if (f) {
      for (const s of f.settlements) {
        if (s.destroyed) continue;
        const rr = Math.max(1.6 + s.tier * 0.8, 10 / this.camera.zoom);
        if ((s.x - wx) ** 2 + (s.y - wy) ** 2 < rr * rr) return { kind: 'settlement', id: s.id, tribeId: s.tribeId };
      }
    }
    return { kind: 'none', id: -1 };
  }

  creaturePos(id: number): { x: number; y: number } | null {
    const d = this.disp.get(id);
    return d ? { x: d.x, y: d.y } : null;
  }

  updateHover(sx: number, sy: number): void {
    this.mouse = { x: sx, y: sy };
    const p = this.pick(sx, sy);
    this.hoverId = p.kind === 'creature' ? p.id : null;
  }

  // ---------------------------------------------------------------- Render

  render(now: number): void {
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    this.syncTerrain();
    this.syncFrame(now);
    const f = this.lastFrame;
    const ctx = this.ctx;
    const cam = this.camera;
    const W = cam.viewW, H = cam.viewH, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, W, H);
    if (!this.terrain || !f) {
      this.drawStarfield(now);
      return;
    }
    this.syncLayers(f.env.season);
    this.syncSnow(f);

    // Smooth creature motion toward the latest simulated positions.
    const k = 1 - Math.exp(-dt * (f.tps > 100 ? 30 : 11));
    for (const d of this.disp.values()) {
      d.x += (d.tx - d.x) * k;
      d.y += (d.ty - d.y) * k;
      let dh = d.th - d.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      d.h += dh * Math.min(1, k * 1.5);
    }
    if (this.followSelected && this.selectedId !== null) {
      const d = this.disp.get(this.selectedId);
      if (d) { cam.targetCx = d.x; cam.targetCy = d.y; }
    }
    cam.update(dt);

    // Screen shake.
    this.shake *= Math.pow(0.04, dt);
    const shx = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;
    const shy = this.shake > 0.2 ? (Math.random() - 0.5) * this.shake : 0;
    const z = cam.zoom;
    const ox = W / 2 - cam.cx * z + shx, oy = H / 2 - cam.cy * z + shy;
    const tw = this.terrain.width, th = this.terrain.height;

    // ---- World layers (in tile units) ----
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrainCanvas, 0, 0, tw, th);
    if (this.overlays.vegetation && this.vegHi.width) ctx.drawImage(this.vegHi, 0, 0, tw, th);
    if (this.snowHi.width) ctx.drawImage(this.snowHi, 0, 0, tw, th);
    if (this.overlays.territory && this.terrHi.width) {
      ctx.drawImage(this.terrHi, 0, 0, tw, th);
      ctx.lineJoin = 'round';
      // Borders recede at overview zoom and sharpen as you close in.
      const rel = z / Math.max(0.1, cam.fitZoom());
      const borderA = Math.min(0.9, Math.max(0.3, 0.3 + (rel - 1) * 0.4));
      for (const bd of this.borders) {
        ctx.strokeStyle = bd.color;
        if (rel >= 1.8) {
          ctx.globalAlpha = 0.18;
          ctx.lineWidth = 5 / z;
          ctx.stroke(bd.path);
        }
        ctx.globalAlpha = borderA;
        ctx.lineWidth = 1.5 / z;
        ctx.stroke(bd.path);
      }
      ctx.globalAlpha = 1;
    }
    const b = cam.bounds(2);
    // Farms.
    if (z > 1.6 && this.farms.length) {
      for (const i of this.farms) {
        const x = i % tw, y = (i / tw) | 0;
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        ctx.fillStyle = (x + y) % 2 ? 'rgba(214,182,92,0.55)' : 'rgba(170,176,72,0.55)';
        ctx.fillRect(x + 0.06, y + 0.06, 0.88, 0.88);
        if (z > 9) {
          ctx.fillStyle = 'rgba(90,70,30,0.35)';
          for (let s = 0.15; s < 0.9; s += 0.2) ctx.fillRect(x + 0.08, y + s, 0.84, 0.05);
        }
      }
    }
    // Water glints.
    const t = now / 1000;
    ctx.fillStyle = 'rgba(220,240,255,0.9)';
    for (let k2 = 0; k2 < this.waterSample.length; k2++) {
      const i = this.waterSample[k2];
      const x = i % tw, y = (i / tw) | 0;
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      const ph = h32(i) * 6.28;
      const s = Math.sin(t * 1.3 + ph);
      if (s < 0.82) continue;
      ctx.globalAlpha = (s - 0.82) * 3.5 * 0.5;
      const jx = h32(i * 3) * 0.8, jy = h32(i * 5) * 0.8;
      ctx.fillRect(x + jx, y + jy, 0.5, 0.06);
    }
    ctx.globalAlpha = 1;

    // ---- Screen-space objects ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toS = (x: number, y: number): [number, number] => [x * z + ox, y * z + oy];
    // Carcasses.
    if (z > 3.5) {
      ctx.fillStyle = 'rgba(120,30,30,0.75)';
      const cc = f.carcasses;
      for (let i = 0; i < cc.length; i += 3) {
        if (cc[i] < b.x0 || cc[i] > b.x1 || cc[i + 1] < b.y0 || cc[i + 1] > b.y1) continue;
        const [sx, sy] = toS(cc[i], cc[i + 1]);
        const r = Math.max(1, Math.min(3, Math.sqrt(cc[i + 2]) * 0.035 * z));
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    this.drawSettlements(f.settlements, toS, b, now);
    this.drawCreatures(toS, b, now);
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    this.drawSelection(toS, now, dt);

    // Fires (additive).
    if (this.fires.length) {
      ctx.globalCompositeOperation = 'lighter';
      const fire = glowSprite(255, 120, 30);
      for (const i of this.fires) {
        const x = i % tw, y = (i / tw) | 0;
        if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
        const [sx, sy] = toS(x + 0.5, y + 0.5);
        const fl = 0.7 + 0.3 * Math.sin(t * 9 + i);
        const r = z * 1.6 * fl;
        ctx.globalAlpha = 0.75;
        ctx.drawImage(fire, sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- Weather ----
    if (this.overlays.weather) this.drawWeather(f.weather, toS, b, dt, now);

    // ---- Day / night lighting ----
    const light = f.env.daylight;
    const dark = 1 - light;
    let r = 255 - dark * 158, g = 255 - dark * 142, bl = 255 - dark * 78;
    const warm = Math.max(0, 1 - Math.abs(light - 0.42) / 0.28) * 0.55;
    r = r + (255 - r) * warm * 0.4; g = g + (196 - g) * warm; bl = bl + (150 - bl) * warm;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    if (dark > 0.25) {
      const glow = glowSprite(255, 150, 60);
      ctx.globalAlpha = Math.min(0.65, (dark - 0.25) * 1.2);
      for (const s of f.settlements) {
        if (s.destroyed) continue;
        if (s.x < b.x0 - 6 || s.x > b.x1 + 6 || s.y < b.y0 - 6 || s.y > b.y1 + 6) continue;
        const [sx, sy] = toS(s.x, s.y);
        const rr = Math.max(12, z * (2 + s.tier * 1.3));
        ctx.drawImage(glow, sx - rr, sy - rr, rr * 2, rr * 2);
      }
      if (z > 5) {
        // Tribe members carry small lights at night.
        const torch = glowSprite(255, 160, 70);
        ctx.globalAlpha = Math.min(0.32, (dark - 0.25) * 0.6);
        for (const d of this.disp.values()) {
          if (!(d.flags & FLAG.tribe) || d.flags & FLAG.resting) continue;
          if (d.x < b.x0 || d.x > b.x1 || d.y < b.y0 || d.y > b.y1) continue;
          const [sx, sy] = toS(d.x, d.y);
          const rr = z * 0.5;
          ctx.drawImage(torch, sx - rr, sy - rr, rr * 2, rr * 2);
        }
      }
      ctx.globalAlpha = 1;
    }
    // At night, a faint additive life signal keeps populations legible at overview zoom.
    if (dark > 0.3 && z < 4.5) {
      ctx.globalAlpha = Math.min(0.55, (dark - 0.3) * 0.9);
      const q = Math.max(1.4, z * 0.32);
      for (const d of this.disp.values()) {
        if (d.x < b.x0 || d.x > b.x1 || d.y < b.y0 || d.y > b.y1) continue;
        ctx.fillStyle = hueColor(d.hue, d.sat, 70);
        ctx.fillRect(d.x * z + ox - q / 2, d.y * z + oy - q / 2, q, q);
      }
      ctx.globalAlpha = 1;
    }
    this.drawFx(toS, now, dt);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(200,220,255,${this.flash * 0.6})`;
      ctx.fillRect(0, 0, W, H);
      this.flash *= Math.pow(0.002, dt);
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---- Labels and UI-ish overlays ----
    if (this.overlays.labels) this.drawLabels(f.settlements, toS, b);
    this.drawBrush();
    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, W, H);
    }
    this.onFrameRendered?.();
  }

  private drawStarfield(now: number): void {
    const ctx = this.ctx, W = this.camera.viewW, H = this.camera.viewH;
    for (let i = 0; i < 160; i++) {
      const x = h32(i * 13) * W, y = h32(i * 29) * H;
      const a = 0.3 + 0.5 * Math.abs(Math.sin(now / 1000 + i));
      ctx.fillStyle = `rgba(180,220,255,${a * 0.6})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  private drawSettlements(list: SettlementView[], toS: (x: number, y: number) => [number, number], b: { x0: number; y0: number; x1: number; y1: number }, now: number): void {
    const ctx = this.ctx, z = this.camera.zoom;
    for (const s of list) {
      if (s.x < b.x0 - 5 || s.x > b.x1 + 5 || s.y < b.y0 - 5 || s.y > b.y1 + 5) continue;
      const [sx, sy] = toS(s.x, s.y);
      const col = `hsl(${Math.round(s.hue * 360)}, 70%, 60%)`;
      if (s.destroyed) {
        ctx.fillStyle = 'rgba(60,56,52,0.85)';
        for (let k = 0; k < 7; k++) {
          const a = h32(s.id * 31 + k) * 6.28, r = h32(s.id * 17 + k) * z * 1.4;
          ctx.fillRect(sx + Math.cos(a) * r, sy + Math.sin(a) * r, Math.max(1.5, z * 0.3), Math.max(1.5, z * 0.22));
        }
        continue;
      }
      if (z < 2.6) {
        const rr = 3 + s.tier * 1.6;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(10,12,18,0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        continue;
      }
      const R = (1.6 + s.tier * 1.0) * z;
      // Ground.
      ctx.fillStyle = 'rgba(110,88,60,0.55)';
      ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.15, R * 1.05, 0, 0, Math.PI * 2); ctx.fill();
      if (s.walls) {
        ctx.strokeStyle = 'rgba(150,146,136,0.95)';
        ctx.lineWidth = Math.max(1.5, z * 0.22);
        ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.2, R * 1.1, 0, 0, Math.PI * 2); ctx.stroke();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.fillStyle = 'rgba(170,164,150,1)';
          const tx = sx + Math.cos(a) * R * 1.2, ty = sy + Math.sin(a) * R * 1.1, ts = Math.max(2, z * 0.32);
          ctx.fillRect(tx - ts / 2, ty - ts / 2, ts, ts);
        }
      }
      const n = Math.min(46, 4 + s.tier * 6 + Math.floor(s.population / 2));
      const hs = Math.max(2.5, z * (0.4 + s.tier * 0.05));
      const roof = `hsl(${Math.round(s.hue * 360)}, 55%, ${s.tier >= 2 ? 42 : 36}%)`;
      const wall = s.tier === 0 ? '#c8ab7c' : s.tier === 1 ? '#b99a6a' : s.tier === 2 ? '#d6cbb5' : '#e2dccd';
      for (let k = 0; k < n; k++) {
        const a = k * 2.39996 + s.id;
        const rr = R * (0.28 + 0.72 * Math.sqrt((k + 0.5) / n));
        const hx = sx + Math.cos(a) * rr, hy = sy + Math.sin(a) * rr * 0.9;
        if (s.tier === 0) {
          ctx.fillStyle = wall;
          ctx.beginPath(); ctx.moveTo(hx, hy - hs * 0.7); ctx.lineTo(hx + hs * 0.6, hy + hs * 0.4); ctx.lineTo(hx - hs * 0.6, hy + hs * 0.4); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(40,30,20,0.6)';
          ctx.fillRect(hx - hs * 0.12, hy, hs * 0.24, hs * 0.4);
        } else {
          ctx.fillStyle = wall;
          ctx.fillRect(hx - hs / 2, hy - hs * 0.2, hs, hs * 0.65);
          ctx.fillStyle = roof;
          ctx.beginPath(); ctx.moveTo(hx - hs * 0.62, hy - hs * 0.2); ctx.lineTo(hx, hy - hs * 0.75); ctx.lineTo(hx + hs * 0.62, hy - hs * 0.2); ctx.closePath(); ctx.fill();
        }
      }
      // Centre: fire pit, plaza, or tower.
      if (s.tier >= 3) {
        ctx.fillStyle = '#e9e2d2';
        ctx.fillRect(sx - z * 0.3, sy - z * 1.6, z * 0.6, z * 1.6);
        ctx.fillStyle = roof;
        ctx.beginPath(); ctx.moveTo(sx - z * 0.45, sy - z * 1.6); ctx.lineTo(sx, sy - z * 2.3); ctx.lineTo(sx + z * 0.45, sy - z * 1.6); ctx.closePath(); ctx.fill();
      } else {
        const fl = 0.7 + 0.3 * Math.sin(now / 90 + s.id);
        ctx.fillStyle = `rgba(255,${150 + fl * 60},60,0.95)`;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, z * 0.18 * fl), 0, Math.PI * 2); ctx.fill();
        // Smoke.
        for (let p = 0; p < 3; p++) {
          const ph = ((now / 2200 + p / 3 + s.id * 0.13) % 1);
          ctx.fillStyle = `rgba(200,200,200,${0.25 * (1 - ph)})`;
          ctx.beginPath(); ctx.arc(sx + Math.sin(ph * 6 + s.id) * z * 0.3, sy - ph * z * 2.2, z * (0.15 + ph * 0.35), 0, Math.PI * 2); ctx.fill();
        }
      }
      // Banner in tribe colour.
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, z * 0.08);
      ctx.beginPath(); ctx.ellipse(sx, sy, R * 1.28, R * 1.18, 0, 0, Math.PI * 2); ctx.stroke();
      if (s.health < 60) {
        ctx.fillStyle = 'rgba(255,80,60,0.85)';
        ctx.fillRect(sx - R, sy + R * 1.3, (2 * R) * (s.health / 100), Math.max(2, z * 0.15));
      }
    }
  }

  private drawCreatures(toS: (x: number, y: number) => [number, number], b: { x0: number; y0: number; x1: number; y1: number }, now: number): void {
    const ctx = this.ctx, z = this.camera.zoom, dpr = this.dpr;
    const detailed = z >= 4.5;
    const [ox, oy] = toS(0, 0);
    if (!detailed) ctx.lineCap = 'round';
    for (const [id, d] of this.disp) {
      if (d.x < b.x0 || d.x > b.x1 || d.y < b.y0 || d.y > b.y1) continue;
      const sx = d.x * z + ox, sy = d.y * z + oy;
      const s = Math.max(2.2, d.size * z * (detailed ? 0.68 : 0.95));
      if (!detailed) {
        // Overview: a short oriented streak, longer while moving, so herds read as flowing groups.
        const resting = d.flags & FLAG.resting;
        const len = resting ? 0.6 : Math.max(1.6, s * 0.9) + (d.flags & FLAG.fleeing ? 2 : 0);
        const cx = Math.cos(d.h) * len, cy = Math.sin(d.h) * len;
        ctx.strokeStyle = hueColor(d.hue, d.sat, resting ? 48 : 64);
        ctx.globalAlpha = resting ? 0.6 : 0.85;
        ctx.lineWidth = Math.max(1.4, s * 0.55);
        ctx.beginPath();
        ctx.moveTo(sx - cx, sy - cy);
        ctx.lineTo(sx + cx * 0.6, sy + cy * 0.6);
        ctx.stroke();
        // Brighter head so each streak reads as an animal moving, not texture.
        ctx.fillStyle = hueColor(d.hue, d.sat, 80);
        ctx.globalAlpha = resting ? 0.7 : 1;
        const hr = Math.max(1, s * 0.34);
        ctx.fillRect(sx + cx * 0.6 - hr, sy + cy * 0.6 - hr, hr * 2, hr * 2);
        continue;
      }
      ctx.globalAlpha = 1;
      if (d.flags & FLAG.notable) {
        ctx.strokeStyle = 'rgba(255,214,110,0.9)';
        ctx.lineWidth = Math.max(1, z * 0.05);
        ctx.beginPath(); ctx.arc(sx, sy, s * 0.75, 0, Math.PI * 2); ctx.stroke();
      }
      if (d.flags & FLAG.infected) {
        ctx.fillStyle = 'rgba(140,220,60,0.25)';
        ctx.beginPath(); ctx.arc(sx, sy, s * 0.8, 0, Math.PI * 2); ctx.fill();
      }
      const spr = creatureSprite(d.hue, d.sat, d.pat, d.diet, d.shape);
      const scale = (s * 1.25) / SPRITE;
      const cos = Math.cos(d.h) * scale, sin = Math.sin(d.h) * scale;
      // Gentle walk bob.
      const bob = d.flags & FLAG.resting ? 0 : Math.sin(now / 90 + id) * 0.04 * s;
      ctx.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, sx * dpr, (sy + bob) * dpr);
      if (d.flags & FLAG.resting) ctx.globalAlpha = 0.78;
      ctx.drawImage(spr, -SPRITE / 2, -SPRITE / 2);
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (d.flags & FLAG.tribe) {
        // Small banner dot in the tribe's colour.
        const r = Math.max(1.8, z * 0.09);
        ctx.fillStyle = `hsl(${Math.round(d.tribeHue * 360)},80%,66%)`;
        ctx.strokeStyle = 'rgba(6,8,14,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx - s * 0.45, sy - s * 0.55, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (d.flags & FLAG.carrying && z > 7) {
        ctx.fillStyle = '#e8c56a';
        ctx.fillRect(sx + s * 0.3, sy - s * 0.5, s * 0.25, s * 0.25);
      }
      if (d.flags & FLAG.hunting && z > 6) {
        ctx.strokeStyle = 'rgba(255,90,70,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, s * 0.9, -0.6, 0.6); ctx.stroke();
      }
      if (d.flags & FLAG.resting && z > 9) {
        // Small crescent moon: sleeping.
        const r = z * 0.13, mx = sx + s * 0.5, my = sy - s * 0.5 - Math.sin(now / 600 + id) * 1.5;
        ctx.fillStyle = 'rgba(220,230,255,0.75)';
        ctx.beginPath();
        ctx.arc(mx, my, r, Math.PI * 0.32, Math.PI * 1.68, false);
        ctx.arc(mx + r * 0.5, my, r * 0.82, Math.PI * 1.42, Math.PI * 0.58, true);
        ctx.closePath();
        ctx.fill();
      }
      if (d.flags & FLAG.mating && z > 7) {
        // Drawn heart: courting.
        const r = z * 0.12, hx = sx, hy = sy - s * 0.7;
        ctx.fillStyle = 'rgba(255,120,170,0.9)';
        ctx.beginPath();
        ctx.moveTo(hx, hy + r * 1.1);
        ctx.bezierCurveTo(hx - r * 1.6, hy - r * 0.2, hx - r * 0.7, hy - r * 1.4, hx, hy - r * 0.5);
        ctx.bezierCurveTo(hx + r * 0.7, hy - r * 1.4, hx + r * 1.6, hy - r * 0.2, hx, hy + r * 1.1);
        ctx.fill();
      }
    }
  }

  private drawSelection(toS: (x: number, y: number) => [number, number], now: number, dt: number): void {
    const ctx = this.ctx, z = this.camera.zoom;
    if (this.hoverId !== null && this.hoverId !== this.selectedId) {
      const d = this.disp.get(this.hoverId);
      if (d) {
        const [sx, sy] = toS(d.x, d.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, d.size * z * 0.85), 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (this.selectedId === null) { this.trail = []; return; }
    const d = this.disp.get(this.selectedId);
    if (!d) return;
    this.trailT += dt;
    if (this.trailT > 0.12) {
      this.trailT = 0;
      this.trail.push([d.x, d.y]);
      if (this.trail.length > 300) this.trail.shift();
    }
    if (this.trail.length > 1) {
      ctx.lineWidth = Math.max(1, z * 0.08);
      for (let i = 1; i < this.trail.length; i++) {
        const [ax, ay] = toS(this.trail[i - 1][0], this.trail[i - 1][1]);
        const [bx, by] = toS(this.trail[i][0], this.trail[i][1]);
        if (Math.abs(ax - bx) + Math.abs(ay - by) > 200) continue;
        ctx.strokeStyle = `rgba(127,224,196,${(i / this.trail.length) * 0.7})`;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
    const [sx, sy] = toS(d.x, d.y);
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const rr = Math.max(9, d.size * z * 0.9) + pulse * 3;
    ctx.strokeStyle = 'rgba(127,224,196,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(127,224,196,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy, rr + 5 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
  }

  private drawWeather(cells: WeatherView[], toS: (x: number, y: number) => [number, number], b: { x0: number; y0: number; x1: number; y1: number }, dt: number, now: number): void {
    const ctx = this.ctx, z = this.camera.zoom;
    const W = this.camera.viewW, H = this.camera.viewH;
    // Shadows then clouds.
    for (let pass = 0; pass < 2; pass++) {
      for (const c of cells) {
        if (c.intensity < 0.02) continue;
        if (c.x + c.radius * 1.4 < b.x0 || c.x - c.radius * 1.4 > b.x1 || c.y + c.radius * 1.4 < b.y0 || c.y - c.radius * 1.4 > b.y1) continue;
        const tone = c.kind === 'storm' ? 2 : c.kind === 'snow' ? 0 : 1;
        for (let p = 0; p < 3; p++) {
          const v = (c.id + p) % 3;
          const spr = pass === 0 ? cloudSprite(v, 2) : cloudSprite(v, tone);
          const ang = h32(c.id * 7 + p) * 6.28;
          const off = p === 0 ? 0 : c.radius * 0.45;
          const cx = c.x + Math.cos(ang) * off + (pass === 0 ? 2.5 : 0);
          const cy = c.y + Math.sin(ang) * off * 0.7 + (pass === 0 ? 3.5 : 0);
          const size = c.radius * (p === 0 ? 2.3 : 1.6) * z;
          const [sx, sy] = toS(cx, cy);
          ctx.globalAlpha = pass === 0 ? c.intensity * 0.22 : c.intensity * (c.kind === 'storm' ? 0.85 : 0.62) * (z > 12 ? 0.5 : 1);
          ctx.drawImage(spr, sx - size / 2, sy - size / 2, size, size);
        }
      }
    }
    ctx.globalAlpha = 1;
    // Precipitation particles.
    const ps = this.particles;
    for (const c of cells) {
      if (c.intensity < 0.15) continue;
      const [cx, cy] = toS(c.x, c.y);
      const rr = c.radius * z;
      if (cx + rr < 0 || cx - rr > W || cy + rr < 0 || cy - rr > H) continue;
      const area = Math.min(1, (rr * rr) / (W * H));
      const n = Math.round(c.intensity * (c.kind === 'snow' ? 60 : 110) * area * 4 + c.intensity * 3);
      for (let k = 0; k < n && ps.length < 1800; k++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * rr;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (x < 0 || x > W || y < 0 || y > H) continue;
        if (c.kind === 'snow') ps.push({ x, y: y - 20, vx: (Math.random() - 0.5) * 12, vy: 22 + Math.random() * 18, life: 0, max: 1.6, kind: 1 });
        else ps.push({ x, y: y - 30, vx: -60, vy: 520 + Math.random() * 120, life: 0, max: 0.1 + Math.random() * 0.12, kind: 0 });
      }
      if (c.kind === 'storm' && Math.random() < 0.012 * c.intensity) {
        const lx = c.x + (Math.random() - 0.5) * c.radius, ly = c.y + (Math.random() - 0.5) * c.radius;
        this.addFx({ kind: 'lightning', x: lx, y: ly, r: 0, tick: 0 }, now);
        this.flash = Math.max(this.flash, 0.25);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(180,205,235,0.55)';
    ctx.beginPath();
    let j = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life > p.max) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 0) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018); }
      ps[j++] = p;
    }
    ps.length = j;
    ctx.stroke();
    ctx.fillStyle = 'rgba(245,248,255,0.85)';
    for (const p of ps) if (p.kind === 1) { p.x += Math.sin(now / 300 + p.y) * 0.3; ctx.fillRect(p.x, p.y, 2, 2); }
  }

  private drawFx(toS: (x: number, y: number) => [number, number], now: number, _dt: number): void {
    const ctx = this.ctx, z = this.camera.zoom;
    const keep: ActiveFx[] = [];
    for (const e of this.fx) {
      const age = (now - e.start) / 1000;
      const [sx, sy] = toS(e.x, e.y);
      let alive = true;
      switch (e.kind) {
        case 'lightning': {
          if (age > 0.45) { alive = false; break; }
          ctx.strokeStyle = `rgba(210,230,255,${1 - age / 0.45})`;
          ctx.lineWidth = 2.5;
          ctx.shadowColor = 'rgba(160,200,255,1)';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          e.bolt!.forEach(([x, y], i) => { const [px, py] = toS(x, y); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
          ctx.stroke();
          ctx.shadowBlur = 0;
          const g = glowSprite(170, 200, 255);
          const r = 30 + e.r * z;
          ctx.globalAlpha = 1 - age / 0.45;
          ctx.drawImage(g, sx - r, sy - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          break;
        }
        case 'quake': {
          if (age > 2.4) { alive = false; break; }
          for (let k = 0; k < 3; k++) {
            const a = age - k * 0.35;
            if (a < 0) continue;
            ctx.strokeStyle = `rgba(230,170,100,${Math.max(0, 0.7 - a / 2)})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(sx, sy, a * e.r * z * 0.8, 0, Math.PI * 2); ctx.stroke();
          }
          break;
        }
        case 'meteor': {
          if (age > 3) { alive = false; break; }
          if (age < 0.6) {
            const p = age / 0.6;
            const fx = sx - (1 - p) * 400, fy = sy - (1 - p) * 500;
            const g = glowSprite(255, 190, 90);
            ctx.drawImage(g, fx - 24, fy - 24, 48, 48);
            ctx.strokeStyle = 'rgba(255,200,120,0.6)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - 80, fy - 100); ctx.stroke();
          } else {
            const a = age - 0.6;
            if (a < 0.05) this.flash = Math.max(this.flash, 0.9);
            const g = glowSprite(255, 140, 50);
            const r = (e.r * z) * (0.5 + a) ;
            ctx.globalAlpha = Math.max(0, 1 - a / 2.4);
            ctx.drawImage(g, sx - r, sy - r, r * 2, r * 2);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = `rgba(255,220,160,${Math.max(0, 0.8 - a / 2)})`;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(sx, sy, a * e.r * z * 1.2, 0, Math.PI * 2); ctx.stroke();
          }
          break;
        }
        case 'volcano': {
          if (age > 8) { alive = false; break; }
          const g = glowSprite(255, 90, 30);
          const r = e.r * z * (1 + 0.2 * Math.sin(now / 120));
          ctx.globalAlpha = Math.max(0, 1 - age / 8);
          ctx.drawImage(g, sx - r, sy - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          break;
        }
        default: {
          const dur = 1.6;
          if (age > dur) { alive = false; break; }
          const col = e.kind === 'spawn' ? '127,224,196' : e.kind === 'bless' ? '255,214,110' : e.kind === 'bloom' ? '120,230,110'
            : e.kind === 'blight' ? '150,90,200' : e.kind === 'plague' ? '160,230,70' : '255,140,60';
          ctx.strokeStyle = `rgba(${col},${1 - age / dur})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, (0.3 + age / dur) * Math.max(1, e.r) * z, 0, Math.PI * 2); ctx.stroke();
          const g = glowSprite(...(col.split(',').map(Number) as [number, number, number]));
          const r = Math.max(1, e.r) * z * 0.9;
          ctx.globalAlpha = 0.5 * (1 - age / dur);
          ctx.drawImage(g, sx - r, sy - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
        }
      }
      if (alive) keep.push(e);
    }
    this.fx = keep;
  }

  private drawLabels(list: SettlementView[], toS: (x: number, y: number) => [number, number], b: { x0: number; y0: number; x1: number; y1: number }): void {
    const ctx = this.ctx, z = this.camera.zoom;
    ctx.textAlign = 'center';
    if (z < 3.2 && this.terrain) {
      ctx.font = '600 11px "Chakra Petch", sans-serif';
      ctx.fillStyle = 'rgba(220,235,245,0.38)';
      for (const lm of this.terrain.landmasses) {
        if (lm.size < 450) continue;
        const [sx, sy] = toS(lm.cx, lm.cy);
        ctx.fillText(lm.name.toUpperCase().split('').join(' '), sx, sy);
      }
    }
    if (z >= 3.2) {
      ctx.font = `600 ${Math.round(Math.min(14, 9 + z * 0.15))}px "Chakra Petch", sans-serif`;
      for (const s of list) {
        if (s.destroyed) continue;
        if (s.x < b.x0 || s.x > b.x1 || s.y < b.y0 || s.y > b.y1) continue;
        if (z < 7 && s.tier === 0 && s.population < 25) continue; // small camps are labelled only up close
        const [sx, sy] = toS(s.x, s.y);
        const yy = sy + (1.6 + s.tier * 1.0) * z * 1.3 + 12;
        const label = `${s.name} · ${s.population}`;
        ctx.fillStyle = 'rgba(4,6,12,0.65)';
        const w = ctx.measureText(label).width + 10;
        ctx.fillRect(sx - w / 2, yy - 11, w, 15);
        ctx.fillStyle = `hsl(${Math.round(s.hue * 360)}, 80%, 76%)`;
        ctx.fillText(label, sx, yy);
      }
    }
    ctx.textAlign = 'start';
  }

  private drawBrush(): void {
    if (!this.mouse || this.brushRadius <= 0) return;
    const ctx = this.ctx;
    const r = this.brushRadius * this.camera.zoom;
    ctx.strokeStyle = this.brushColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(this.mouse.x, this.mouse.y, Math.max(6, r), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Draw a minimap into another canvas. */
  drawMinimap(target: HTMLCanvasElement): void {
    if (!this.terrain) return;
    const g = target.getContext('2d')!;
    const W = target.width, H = target.height;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.terrainCanvas, 0, 0, W, H);
    if (this.snowHi.width) g.drawImage(this.snowHi, 0, 0, W, H);
    if (this.overlays.territory && this.terrHi.width) g.drawImage(this.terrHi, 0, 0, W, H);
    const sx = W / this.terrain.width, sy = H / this.terrain.height;
    g.fillStyle = 'rgba(255,255,255,0.75)';
    let k = 0;
    for (const d of this.disp.values()) {
      if ((k++ & 3) !== 0) continue;
      g.fillRect(d.x * sx, d.y * sy, 1, 1);
    }
    const f = this.lastFrame;
    if (f) {
      g.globalAlpha = Math.max(0, (1 - f.env.daylight) * 0.45);
      g.fillStyle = '#0a1430';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    const b = this.camera.bounds(0);
    g.strokeStyle = 'rgba(127,224,196,0.95)';
    g.lineWidth = 1.5;
    g.strokeRect(b.x0 * sx, b.y0 * sy, (b.x1 - b.x0) * sx, (b.y1 - b.y0) * sy);
    if (this.selectedId !== null) {
      const d = this.disp.get(this.selectedId);
      if (d) {
        g.fillStyle = '#7fe0c4';
        g.beginPath(); g.arc(d.x * sx, d.y * sy, 3, 0, Math.PI * 2); g.fill();
      }
    }
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const OVR = 4;

/** Upscale a tile-resolution layer and blur it once, so overlays read as soft fields rather than tiles. */
function soften(src: HTMLCanvasElement, dst: HTMLCanvasElement, blurTiles: number): void {
  if (!src.width) return;
  const w = src.width * OVR, h = src.height * OVR;
  if (dst.width !== w || dst.height !== h) { dst.width = w; dst.height = h; }
  const g = dst.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.filter = `blur(${(blurTiles * OVR * 0.5).toFixed(1)}px)`;
  g.drawImage(src, 0, 0, w, h);
  g.filter = 'none';
}

/** Marching-squares contours of each tribe's territory on a smoothed membership field. */
function territoryBorders(terr: Int16Array, W: number, H: number, hues: Record<number, number>): { color: string; path: Path2D }[] {
  const out: { color: string; path: Path2D }[] = [];
  const owners = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < terr.length; i++) {
    const o = terr[i];
    if (o < 0) continue;
    const x = i % W, y = (i / W) | 0;
    const b = owners.get(o);
    if (!b) owners.set(o, [x, y, x, y]);
    else { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  }
  for (const [owner, bb] of owners) {
    const x0 = Math.max(0, bb[0] - 2), y0 = Math.max(0, bb[1] - 2), x1 = Math.min(W, bb[2] + 3), y1 = Math.min(H, bb[3] + 3);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const f = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        let s = 0;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
          const tx = x0 + x + dx, ty = y0 + y + dy;
          if (tx >= 0 && ty >= 0 && tx < W && ty < H && terr[ty * W + tx] === owner) s++;
        }
        f[y * cw + x] = s / 4;
      }
    }
    const g = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
        s += f[yy * cw + xx]; n++;
      }
      g[y * cw + x] = s / n;
    }
    const path = new Path2D();
    const T = 0.5;
    const lerp = (a: number, b: number) => (T - a) / (b - a || 1e-6);
    for (let y = 0; y < ch - 1; y++) {
      for (let x = 0; x < cw - 1; x++) {
        const a = g[y * cw + x], b = g[y * cw + x + 1], c = g[(y + 1) * cw + x + 1], d = g[(y + 1) * cw + x];
        const idx = (a > T ? 8 : 0) | (b > T ? 4 : 0) | (c > T ? 2 : 0) | (d > T ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const X = x0 + x, Y = y0 + y;
        const top: [number, number] = [X + lerp(a, b), Y];
        const right: [number, number] = [X + 1, Y + lerp(b, c)];
        const bottom: [number, number] = [X + lerp(d, c), Y + 1];
        const left: [number, number] = [X, Y + lerp(a, d)];
        const seg = (p: [number, number], q: [number, number]) => { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
    const h = hues[owner] ?? 0;
    out.push({ color: `hsl(${Math.round(h * 360)}, 78%, 68%)`, path });
  }
  return out;
}

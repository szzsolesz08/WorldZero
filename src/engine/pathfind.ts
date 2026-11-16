import type { World } from './world/world';

/**
 * Tile-grid A* used for migration routes. It runs once per migration group (not per tick).
 * Cost per step = distance / moveMult, times `extraCost(tile)` (e.g. hostile territory).
 * Returns waypoints [x0, y0, x1, y1, ...] in tile-centre coordinates, thinned to every few tiles,
 * always ending at the target, or null if unreachable within the expansion budget.
 */
export function findPath(
  w: World, sx: number, sy: number, tx: number, ty: number, swim: number, sail: boolean,
  extraCost: ((i: number) => number) | null = null, maxExpand = 40000,
): number[] | null {
  const W = w.width, H = w.height;
  const clampX = (x: number) => Math.min(W - 1, Math.max(0, Math.floor(x)));
  const clampY = (y: number) => Math.min(H - 1, Math.max(0, Math.floor(y)));
  const start = clampY(sy) * W + clampX(sx);
  const goal = clampY(ty) * W + clampX(tx);
  if (start === goal) return [tx, ty];
  const n = W * H;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // Binary heap of (f, node).
  let hf = new Float32Array(1024), hn = new Int32Array(1024), size = 0;
  const push = (f: number, node: number) => {
    if (size === hf.length) {
      const nf = new Float32Array(size * 2); nf.set(hf); hf = nf;
      const nn = new Int32Array(size * 2); nn.set(hn); hn = nn;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hf[i] = hf[p]; hn[i] = hn[p]; i = p;
    }
    hf[i] = f; hn[i] = node;
  };
  const pop = (): number => {
    const top = hn[0];
    const f = hf[--size], node = hn[size];
    let i = 0;
    while (true) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= f) break;
      hf[i] = hf[c]; hn[i] = hn[c]; i = c;
    }
    hf[i] = f; hn[i] = node;
    return top;
  };
  const gx = goal % W, gy = (goal / W) | 0;
  const h = (i: number) => {
    const dx = Math.abs((i % W) - gx), dy = Math.abs(((i / W) | 0) - gy);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  g[start] = 0;
  push(h(start), start);
  let expanded = 0;
  let found = false;
  while (size > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) { found = true; break; }
    closed[cur] = 1;
    if (++expanded > maxExpand) break;
    const cx = cur % W, cy = (cur / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (closed[ni]) continue;
        const mm = ni === goal ? Math.max(0.3, w.moveMult(ni, swim, sail)) : w.moveMult(ni, swim, sail);
        if (mm <= 0) continue;
        // Don't cut corners between two impassable tiles.
        if (dx && dy && (w.moveMult(cy * W + nx, swim, sail) <= 0 || w.moveMult(ny * W + cx, swim, sail) <= 0)) continue;
        const step = (dx && dy ? Math.SQRT2 : 1) / mm * (extraCost ? extraCost(ni) : 1);
        const ng = g[cur] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          push(ng + h(ni), ni);
        }
      }
    }
  }
  if (!found) return null;
  const tiles: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) tiles.push(c);
  tiles.reverse();
  const out: number[] = [];
  for (let k = 4; k < tiles.length - 1; k += 4) out.push((tiles[k] % W) + 0.5, Math.floor(tiles[k] / W) + 0.5);
  out.push(tx, ty);
  return out;
}

/** Length of a waypoint route starting from (x, y). */
export function routeLength(x: number, y: number, wps: number[]): number {
  let d = 0, px = x, py = y;
  for (let k = 0; k < wps.length; k += 2) {
    d += Math.sqrt((wps[k] - px) ** 2 + (wps[k + 1] - py) ** 2);
    px = wps[k]; py = wps[k + 1];
  }
  return d;
}

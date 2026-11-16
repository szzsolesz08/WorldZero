import type { Creature } from './creatures/creature';

/**
 * Uniform-grid spatial hash rebuilt each tick with a counting sort: positions live in flat typed
 * arrays grouped by cell, so neighbour scans read contiguous memory instead of chasing objects.
 */
export class SpatialHash {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** cellStart[c]..cellStart[c+1] is the slice of entries in cell c. */
  cellStart: Int32Array;
  xs: Float32Array = new Float32Array(0);
  ys: Float32Array = new Float32Array(0);
  refs: Creature[] = [];
  private cellOf: Int32Array = new Int32Array(0);
  private fill: Int32Array;

  constructor(width: number, height: number, cell: number) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.fill = new Int32Array(this.cols * this.rows);
  }

  cellIndex(x: number, y: number): number {
    let cx = (x / this.cell) | 0, cy = (y / this.cell) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  rebuild(creatures: Creature[]): void {
    const n = creatures.length;
    if (this.xs.length < n) {
      const cap = Math.max(64, n * 2);
      this.xs = new Float32Array(cap);
      this.ys = new Float32Array(cap);
      this.cellOf = new Int32Array(cap);
    }
    const start = this.cellStart, fill = this.fill;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const c = creatures[i];
      const ci = c.alive ? this.cellIndex(c.x, c.y) : -1;
      this.cellOf[i] = ci;
      if (ci >= 0) start[ci + 1]++;
    }
    for (let k = 1; k < start.length; k++) start[k] += start[k - 1];
    fill.set(start.subarray(0, fill.length));
    const refs = this.refs;
    refs.length = start[start.length - 1];
    for (let i = 0; i < n; i++) {
      const ci = this.cellOf[i];
      if (ci < 0) continue;
      const p = fill[ci]++;
      const c = creatures[i];
      this.xs[p] = c.x;
      this.ys[p] = c.y;
      refs[p] = c;
    }
  }

  /**
   * Collect up to `max` living creatures within radius r of (x, y), nearest rings first.
   * Returns the count.
   */
  query(x: number, y: number, r: number, out: Creature[], max = 48, exclude: Creature | null = null): number {
    out.length = 0;
    const r2 = r * r;
    const cell = this.cell, cols = this.cols, rows = this.rows;
    const ccx = Math.min(cols - 1, Math.max(0, (x / cell) | 0));
    const ccy = Math.min(rows - 1, Math.max(0, (y / cell) | 0));
    const R = Math.ceil(r / cell);
    const xs = this.xs, ys = this.ys, refs = this.refs, start = this.cellStart;
    for (let ring = 0; ring <= R; ring++) {
      const y0 = ccy - ring, y1 = ccy + ring, x0 = ccx - ring, x1 = ccx + ring;
      for (let cy = y0; cy <= y1; cy++) {
        if (cy < 0 || cy >= rows) continue;
        const edgeRow = cy === y0 || cy === y1;
        const step = edgeRow ? 1 : x1 - x0;
        for (let cx = x0; cx <= x1; cx += step || 1) {
          if (cx < 0 || cx >= cols) continue;
          const ci = cy * cols + cx;
          for (let k = start[ci], e = start[ci + 1]; k < e; k++) {
            const dx = xs[k] - x, dy = ys[k] - y;
            if (dx * dx + dy * dy > r2) continue;
            const o = refs[k];
            if (o === exclude || !o.alive) continue;
            out.push(o);
            if (out.length >= max) return out.length;
          }
        }
      }
    }
    return out.length;
  }

  countAt(ci: number): number {
    return this.cellStart[ci + 1] - this.cellStart[ci];
  }
}

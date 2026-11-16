import type { Creature } from './creatures/creature';

/** Uniform-grid spatial hash rebuilt each tick. */
export class SpatialHash {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  cells: Creature[][];

  constructor(width: number, height: number, cell: number) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  cellIndex(x: number, y: number): number {
    let cx = (x / this.cell) | 0, cy = (y / this.cell) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  rebuild(creatures: Creature[]): void {
    for (const c of this.cells) c.length = 0;
    for (const c of creatures) if (c.alive) this.cells[this.cellIndex(c.x, c.y)].push(c);
  }

  /** Collect up to `max` living creatures within radius r of (x, y) into out. Returns count. */
  query(x: number, y: number, r: number, out: Creature[], max = 48, exclude: Creature | null = null): number {
    out.length = 0;
    const r2 = r * r;
    const c0 = Math.max(0, ((x - r) / this.cell) | 0), c1 = Math.min(this.cols - 1, ((x + r) / this.cell) | 0);
    const r0 = Math.max(0, ((y - r) / this.cell) | 0), r1 = Math.min(this.rows - 1, ((y + r) / this.cell) | 0);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const list = this.cells[cy * this.cols + cx];
        for (let k = 0; k < list.length; k++) {
          const o = list[k];
          if (o === exclude || !o.alive) continue;
          const dx = o.x - x, dy = o.y - y;
          if (dx * dx + dy * dy <= r2) {
            out.push(o);
            if (out.length >= max) return out.length;
          }
        }
      }
    }
    return out.length;
  }

  countAt(ci: number): number {
    return this.cells[ci].length;
  }
}

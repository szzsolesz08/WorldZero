import { Rng } from '../rng';
import { World } from './world';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants';

export type WeatherKind = 'rain' | 'storm' | 'snow';

export interface WeatherCell {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  intensity: number;
  kind: WeatherKind;
  life: number;
  maxLife: number;
  /** Forced cells (god-made) keep their kind regardless of temperature. */
  forced: boolean;
}

export class Climate {
  /** User-controlled global temperature offset (°C). */
  tempOffset = 0;
  /** Scenario-driven trend (°C per year) and the accumulated drift. */
  tempTrend = 0;
  drift = 0;
  trendLimit = 0;
  /** Volcanic/meteor winter (°C, negative), decays over time. */
  impactWinter = 0;
  rainMult = 1;
  droughtTicks = 0;
  droughtSeverity = 0;
  windAngle = 0;
  cells: WeatherCell[] = [];
  nextCellId = 1;
  lastClassifiedOffset = 0;
  /** Ambient storminess multiplier (Apocalypse raises it). */
  storminess = 1;

  yearPhase(tick: number): number {
    return (tick % TICKS_PER_YEAR) / TICKS_PER_YEAR;
  }

  season(tick: number): number {
    return Math.floor(this.yearPhase(tick) * 4) % 4;
  }

  /** 0 = midnight, 0.5 = noon */
  dayPhase(tick: number): number {
    return (tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  }

  sun(tick: number): number {
    return Math.sin(2 * Math.PI * (this.dayPhase(tick) - 0.25));
  }

  /** Ambient light 0..1 */
  daylight(tick: number): number {
    return Math.min(1, Math.max(0, this.sun(tick) * 1.5 + 0.4));
  }

  isNight(tick: number): boolean {
    return this.daylight(tick) < 0.2;
  }

  globalOffset(): number {
    return this.tempOffset + this.drift + this.impactWinter;
  }

  seasonalOffset(tick: number, lat: number): number {
    return (4 + 12 * lat) * Math.sin(2 * Math.PI * (this.yearPhase(tick) - 0.125));
  }

  effectiveRain(): number {
    return this.rainMult * (this.droughtTicks > 0 ? 1 - this.droughtSeverity : 1);
  }

  /** Temperature at a tile right now (°C), excluding local weather. */
  tileTemp(world: World, i: number, tick: number): number {
    const y = (i / world.width) | 0;
    const lat = Math.abs(y / world.height - 0.5) * 2;
    return world.baseTemp[i] + this.seasonalOffset(tick, lat) + this.globalOffset() + this.sun(tick) * 2.5;
  }

  /** Local weather cell at (x, y), if any (strongest). */
  weatherAt(x: number, y: number): WeatherCell | null {
    let best: WeatherCell | null = null;
    let bi = 0;
    for (const c of this.cells) {
      const dx = c.x - x, dy = c.y - y;
      const r2 = c.radius * c.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const s = c.intensity * (1 - d2 / r2);
        if (s > bi) { bi = s; best = c; }
      }
    }
    return best;
  }

  spawnCell(rng: Rng, world: World, tick: number, x: number, y: number, kind: WeatherKind | null, forced = false, radius?: number): WeatherCell {
    const i = world.tileAt(x, y);
    const t = this.tileTemp(world, i, tick);
    let k: WeatherKind = kind ?? (t < 0 ? 'snow' : rng.chance(0.16 * this.storminess) ? 'storm' : 'rain');
    if (!forced && k === 'rain' && t < 0) k = 'snow';
    const speed = rng.range(0.015, 0.04) * (k === 'storm' ? 1.5 : 1);
    const ang = this.windAngle + rng.range(-0.5, 0.5);
    const cell: WeatherCell = {
      id: this.nextCellId++,
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      radius: radius ?? rng.range(9, 20) * (k === 'storm' ? 0.8 : 1),
      intensity: 0,
      kind: k,
      life: 0,
      maxLife: rng.int(TICKS_PER_DAY * 1, TICKS_PER_DAY * 3),
      forced,
    };
    this.cells.push(cell);
    return cell;
  }

  update(world: World, rng: Rng, tick: number): void {
    // Long-term climate trend (e.g. Ice Age) with a limit.
    if (this.tempTrend !== 0) {
      this.drift += this.tempTrend / TICKS_PER_YEAR;
      if (this.tempTrend < 0 && this.drift < this.trendLimit) this.drift = this.trendLimit;
      if (this.tempTrend > 0 && this.drift > this.trendLimit) this.drift = this.trendLimit;
    }
    if (this.impactWinter !== 0) {
      this.impactWinter *= 0.99975;
      if (Math.abs(this.impactWinter) < 0.05) this.impactWinter = 0;
    }
    if (this.droughtTicks > 0) this.droughtTicks--;
    this.windAngle += rng.gauss(0, 0.004);

    // Advance cells.
    for (let k = this.cells.length - 1; k >= 0; k--) {
      const c = this.cells[k];
      c.x += c.vx;
      c.y += c.vy;
      c.life++;
      const ramp = Math.min(1, c.life / 120, (c.maxLife - c.life) / 120);
      const base = c.kind === 'storm' ? 1 : 0.8;
      c.intensity = Math.max(0, ramp * base * (this.droughtTicks > 0 && !c.forced ? 0.4 : 1));
      if (!c.forced && c.kind !== 'storm') {
        const t = this.tileTemp(world, world.tileAt(c.x, c.y), tick);
        c.kind = t < -1 ? 'snow' : 'rain';
      }
      if (c.life >= c.maxLife || c.x < -30 || c.y < -30 || c.x > world.width + 30 || c.y > world.height + 30) {
        this.cells.splice(k, 1);
      }
    }

    // Spawn new cells according to rainfall, season and drought.
    const season = this.season(tick);
    const seasonFactor = [1.25, 0.8, 1.1, 0.95][season];
    const target = Math.round(8 * this.effectiveRain() * seasonFactor * Math.sqrt(world.size / 40960));
    if (this.cells.length < target && rng.chance(0.01)) {
      // Prefer moist regions.
      let x = 0, y = 0;
      for (let a = 0; a < 6; a++) {
        x = rng.range(0, world.width);
        y = rng.range(0, world.height);
        if (world.moisture[world.tileAt(x, y)] > rng.next()) break;
      }
      this.spawnCell(rng, world, tick, x, y, null);
    }
  }

  /** Stamp current weather into the world's decaying rain grid. */
  stampRain(world: World): void {
    const rain = world.rain;
    for (let i = 0; i < rain.length; i++) rain[i] *= 0.92;
    const W = world.width, H = world.height;
    for (const c of this.cells) {
      if (c.intensity <= 0.02) continue;
      const r = c.radius;
      const x0 = Math.max(0, Math.floor(c.x - r)), x1 = Math.min(W - 1, Math.ceil(c.x + r));
      const y0 = Math.max(0, Math.floor(c.y - r)), y1 = Math.min(H - 1, Math.ceil(c.y + r));
      const amt = c.intensity * (c.kind === 'snow' ? 0.1 : c.kind === 'storm' ? 0.35 : 0.25);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - c.x, dy = y + 0.5 - c.y;
          const d2 = (dx * dx + dy * dy) / (r * r);
          if (d2 >= 1) continue;
          const i = y * W + x;
          rain[i] = Math.min(1, rain[i] + amt * (1 - d2));
        }
      }
    }
  }

  serialize() {
    return {
      tempOffset: this.tempOffset, tempTrend: this.tempTrend, drift: this.drift, trendLimit: this.trendLimit,
      impactWinter: this.impactWinter, rainMult: this.rainMult, droughtTicks: this.droughtTicks,
      droughtSeverity: this.droughtSeverity, windAngle: this.windAngle, cells: this.cells.map((c) => ({ ...c })),
      nextCellId: this.nextCellId, lastClassifiedOffset: this.lastClassifiedOffset, storminess: this.storminess,
    };
  }

  static deserialize(d: ReturnType<Climate['serialize']>): Climate {
    const c = new Climate();
    Object.assign(c, d);
    c.cells = d.cells.map((x) => ({ ...x }));
    return c;
  }
}

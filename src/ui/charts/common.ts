import { useEffect, useRef, useState } from 'react';
import { TICKS_PER_YEAR, TICKS_PER_DAY } from '../../engine/constants';

/** Track an element's width. */
export function useWidth<T extends HTMLElement>(initial = 340): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(120, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(120, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Nice upper bound and step for a 0-based axis with ~3 ticks. */
export function niceAxis(min: number, max: number, ticks = 3): { lo: number; hi: number; step: number } {
  if (!isFinite(max) || max <= min) max = min + 1;
  const span = max - min;
  const raw = span / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { lo, hi, step };
}

export function fmtNum(v: number, digits = 0): string {
  if (!isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 1000).toFixed(a >= 100000 ? 0 : 1)}K`;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** Axis time label; pass the axis span's last tick so every label on one axis uses the same unit. */
export function fmtTickTime(tick: number, axisEnd = tick): string {
  if (axisEnd >= TICKS_PER_YEAR) {
    const y = tick / TICKS_PER_YEAR + 1;
    return axisEnd >= TICKS_PER_YEAR * 9 ? `Year ${Math.floor(y)}` : `Year ${y.toFixed(1)}`;
  }
  return `Day ${Math.floor(tick / TICKS_PER_DAY) + 1}`;
}

export function fmtDate(tick: number): string {
  const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
  const season = ['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor((tick % TICKS_PER_YEAR) / (TICKS_PER_YEAR / 4))];
  const day = Math.floor((tick % (TICKS_PER_YEAR / 4)) / TICKS_PER_DAY) + 1;
  return `Year ${year}, ${season} day ${day}`;
}

export function hsl(h: number, s = 70, l = 60): string {
  return `hsl(${Math.round(((h % 1) + 1) % 1 * 360)}, ${s}%, ${l}%)`;
}

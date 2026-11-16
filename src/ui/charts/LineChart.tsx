import { useMemo, useState } from 'react';
import { useWidth, niceAxis, fmtNum, fmtTickTime, fmtDate } from './common';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

interface Props {
  title: string;
  aside?: string;
  x: number[];
  series: LineSeries[];
  height?: number;
  format?: (v: number) => string;
  /** Fixed y-domain; otherwise 0..nice(max) (or min..max when allowNegative). */
  domain?: [number, number];
  allowNegative?: boolean;
  area?: boolean;
}

const PAD = { l: 34, r: 40, t: 8, b: 18 };

export function LineChart({ title, aside, x, series, height = 120, format = (v) => fmtNum(v), domain, allowNegative, area = true }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = x.length;
  const geo = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const v of s.values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const axis = domain ? { lo: domain[0], hi: domain[1], step: (domain[1] - domain[0]) / 2 } : niceAxis(allowNegative ? lo : Math.min(0, lo), hi);
    const iw = Math.max(10, width - PAD.l - PAD.r), ih = height - PAD.t - PAD.b;
    const sx = (i: number) => PAD.l + (n <= 1 ? iw : (i / (n - 1)) * iw);
    const sy = (v: number) => PAD.t + ih - ((v - axis.lo) / (axis.hi - axis.lo || 1)) * ih;
    const paths = series.map((s) => {
      let d = '';
      s.values.forEach((v, i) => { d += `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`; });
      const base = sy(Math.max(axis.lo, 0));
      const a = n > 1 ? `${d}L${sx(n - 1).toFixed(1)},${base}L${sx(0).toFixed(1)},${base}Z` : '';
      return { d, a };
    });
    const ticks: number[] = [];
    for (let v = axis.lo; v <= axis.hi + axis.step * 0.01; v += axis.step) ticks.push(v);
    return { axis, iw, ih, sx, sy, paths, ticks };
  }, [series, width, height, n, domain, allowNegative]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round((px / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const xLabels = [...new Set(n > 1 ? (width < 260 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1]) : [0])];
  const single = series.length === 1;
  return (
    <div className="chart" ref={ref}>
      <div className="chart-title">
        <h3>{title}</h3>
        {aside && <span className="aside">{aside}</span>}
      </div>
      {n < 2 ? (
        <div className="empty" style={{ height }}>Collecting data — the first readings arrive within half a day.</div>
      ) : (
        <svg width={width} height={height} role="img" aria-label={`${title} over time`}>
          <g className="axis">
            {geo.ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={PAD.l} x2={width - PAD.r} y1={geo.sy(t)} y2={geo.sy(t)} />
                <text x={PAD.l - 6} y={geo.sy(t) + 3.5} textAnchor="end">{format(t)}</text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} x={geo.sx(i)} y={height - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{fmtTickTime(x[i], x[n - 1])}</text>
            ))}
          </g>
          {series.map((s, k) => (
            <g key={s.key}>
              {area && single && <path d={geo.paths[k].a} fill={s.color} opacity={0.1} />}
              <path d={geo.paths[k].d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {series.map((s, k) => {
            const v = s.values[n - 1];
            const ys = series.map((o) => geo.sy(o.values[n - 1]));
            const collides = ys.some((y, j) => j !== k && Math.abs(y - ys[k]) < 12);
            return (
              <g key={`end-${s.key}`}>
                <circle cx={geo.sx(n - 1)} cy={geo.sy(v)} r={4} fill={s.color} stroke="var(--panel-solid)" strokeWidth={2} />
                {series.length <= 3 && !collides && (
                  <text x={geo.sx(n - 1) + 7} y={geo.sy(v) + 3.5} fill="var(--text-1)" fontSize={11} fontWeight={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{format(v)}</text>
                )}
              </g>
            );
          })}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={geo.sx(hover)} x2={geo.sx(hover)} y1={PAD.t} y2={PAD.t + geo.ih} stroke="var(--text-3)" strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.key} cx={geo.sx(hover)} cy={geo.sy(s.values[hover])} r={4} fill={s.color} stroke="var(--panel-solid)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={PAD.l} y={0} width={Math.max(1, width - PAD.l - PAD.r)} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && n >= 2 && (
        <div className="tooltip" style={{ left: Math.min(width - 150, Math.max(0, geo.sx(hover) + 10)), top: 22 }}>
          <div className="t-head">{fmtDate(x[hover])}</div>
          {series.map((s) => (
            <div className="t-row" key={s.key}><i style={{ background: s.color }} /><b>{format(s.values[hover])}</b><span>{s.label}</span></div>
          ))}
        </div>
      )}
      {series.length >= 2 && (
        <div className="legend">
          {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
    </div>
  );
}

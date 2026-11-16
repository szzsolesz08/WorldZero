import { useMemo, useState } from 'react';
import type { SpeciesView } from '../../engine/types';
import { useWidth, niceAxis, fmtNum, fmtTickTime, fmtDate } from './common';

interface Props {
  x: number[];
  speciesHistory: Record<number, number[]>;
  species: SpeciesView[];
  height?: number;
}

const PAD = { l: 34, r: 8, t: 8, b: 18 };
const MAX_LAYERS = 7;

/** Stacked population by species: the top species by current population, the rest folded into "Other". */
export function SpeciesStack({ x, speciesHistory, species, height = 150 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const n = x.length;
  const layers = useMemo(() => {
    const byId = new Map(species.map((s) => [s.id, s]));
    const entries = Object.entries(speciesHistory).map(([id, arr]) => ({ id: Number(id), arr }));
    // Rank by recent population (sum over the last few samples), stable by id.
    const score = (arr: number[]) => arr.slice(-6).reduce((a, b) => a + b, 0);
    entries.sort((a, b) => score(b.arr) - score(a.arr) || a.id - b.id);
    const top = entries.filter((e) => score(e.arr) > 0).slice(0, MAX_LAYERS);
    const topIds = new Set(top.map((t) => t.id));
    const other = new Array(n).fill(0);
    for (const e of entries) if (!topIds.has(e.id)) for (let i = 0; i < n; i++) other[i] += e.arr[i] ?? 0;
    const out = top
      .sort((a, b) => a.id - b.id)
      .map((t) => {
        const sp = byId.get(t.id);
        const vals = new Array(n).fill(0).map((_, i) => t.arr[i] ?? 0);
        return { key: String(t.id), label: sp ? sp.common : `Species ${t.id}`, sub: sp?.name ?? '', color: sp?.color ?? 'gray', values: vals };
      });
    if (other.some((v) => v > 0)) out.push({ key: 'other', label: 'Other species', sub: '', color: 'hsl(210, 10%, 45%)', values: other });
    return out;
  }, [speciesHistory, species, n]);

  const geo = useMemo(() => {
    const totals = new Array(n).fill(0);
    for (const l of layers) for (let i = 0; i < n; i++) totals[i] += l.values[i];
    const axis = niceAxis(0, Math.max(1, ...totals));
    const iw = Math.max(10, width - PAD.l - PAD.r), ih = height - PAD.t - PAD.b;
    const sx = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
    const sy = (v: number) => PAD.t + ih - (v / axis.hi) * ih;
    const acc = new Array(n).fill(0);
    const paths = layers.map((l) => {
      const lower = acc.slice();
      for (let i = 0; i < n; i++) acc[i] += l.values[i];
      let d = '';
      for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(acc[i]).toFixed(1)}`;
      let top = d;
      for (let i = n - 1; i >= 0; i--) d += `L${sx(i).toFixed(1)},${sy(lower[i]).toFixed(1)}`;
      d += 'Z';
      return { fill: d, top };
    });
    const ticks: number[] = [];
    for (let v = 0; v <= axis.hi + 1e-9; v += axis.step) ticks.push(v);
    return { axis, sx, sy, paths, ticks, ih };
  }, [layers, width, height, n]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart" ref={ref}>
      <div className="chart-title">
        <h3>Population by species</h3>
        <button className="table-toggle" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Show chart' : 'Show table'}</button>
      </div>
      {n < 2 || layers.length === 0 ? (
        <div className="empty" style={{ height }}>Collecting data…</div>
      ) : table ? (
        <table className="data-table">
          <thead><tr><th>Species</th><th>Peak</th><th>Now</th></tr></thead>
          <tbody>
            {layers.map((l) => (
              <tr key={l.key}><td>{l.label}</td><td>{fmtNum(Math.max(...l.values))}</td><td>{fmtNum(l.values[n - 1])}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg width={width} height={height} role="img" aria-label="Stacked population by species over time">
          <g className="axis">
            {geo.ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={PAD.l} x2={width - PAD.r} y1={geo.sy(t)} y2={geo.sy(t)} />
                <text x={PAD.l - 6} y={geo.sy(t) + 3.5} textAnchor="end">{fmtNum(t)}</text>
              </g>
            ))}
            <text x={PAD.l} y={height - 4}>{fmtTickTime(x[0], x[n - 1])}</text>
            <text x={width - PAD.r} y={height - 4} textAnchor="end">{fmtTickTime(x[n - 1], x[n - 1])}</text>
          </g>
          {layers.map((l, k) => (
            <g key={l.key}>
              <path d={geo.paths[k].fill} fill={l.color} opacity={hover === null ? 0.78 : 0.62} />
              <path d={geo.paths[k].top} fill="none" stroke="var(--panel-solid)" strokeWidth={1.5} />
            </g>
          ))}
          {hover !== null && <line x1={geo.sx(hover)} x2={geo.sx(hover)} y1={PAD.t} y2={PAD.t + geo.ih} stroke="var(--text-1)" strokeOpacity={0.6} strokeWidth={1} pointerEvents="none" />}
          <rect x={PAD.l} y={0} width={Math.max(1, width - PAD.l - PAD.r)} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && !table && n >= 2 && (
        <div className="tooltip" style={{ left: Math.min(width - 190, Math.max(0, geo.sx(hover) + 10)), top: 22 }}>
          <div className="t-head">{fmtDate(x[hover])}</div>
          {layers.slice().reverse().map((l) => (
            <div className="t-row" key={l.key}><i style={{ background: l.color }} /><b>{fmtNum(l.values[hover])}</b><span>{l.label}</span></div>
          ))}
        </div>
      )}
      {!table && (
        <div className="legend">
          {layers.map((l) => <span key={l.key} title={l.sub}><i className="box" style={{ background: l.color }} />{l.label}</span>)}
        </div>
      )}
    </div>
  );
}

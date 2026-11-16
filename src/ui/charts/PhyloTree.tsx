import { useMemo, useState } from 'react';
import type { SpeciesView } from '../../engine/types';
import { useWidth, fmtDate, fmtTickTime } from './common';

interface Props {
  species: SpeciesView[];
  now: number;
  onSelect?: (id: number) => void;
}

const ROW = 18;
const PAD = { l: 8, r: 118, t: 8, b: 20 };

/** Phylogenetic tree: each species is a branch from its origin to now (or its extinction). */
export function PhyloTree({ species, now, onSelect }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const layout = useMemo(() => {
    const kids = new Map<number, SpeciesView[]>();
    const roots: SpeciesView[] = [];
    const ids = new Set(species.map((s) => s.id));
    for (const s of species) {
      if (s.parentId >= 0 && ids.has(s.parentId)) {
        const arr = kids.get(s.parentId) ?? [];
        arr.push(s);
        kids.set(s.parentId, arr);
      } else roots.push(s);
    }
    const order: SpeciesView[] = [];
    const walk = (s: SpeciesView) => {
      order.push(s);
      for (const c of (kids.get(s.id) ?? []).sort((a, b) => a.originTick - b.originTick)) walk(c);
    };
    roots.sort((a, b) => a.originTick - b.originTick || a.id - b.id).forEach(walk);
    const row = new Map(order.map((s, i) => [s.id, i]));
    return { order, row };
  }, [species]);

  const t0 = 0, t1 = Math.max(now, 1);
  const iw = Math.max(40, width - PAD.l - PAD.r);
  const sx = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
  const sy = (i: number) => PAD.t + i * ROW + ROW / 2;
  const height = PAD.t + layout.order.length * ROW + PAD.b;
  const maxPop = Math.max(1, ...species.map((s) => s.population));
  const hov = hover !== null ? species.find((s) => s.id === hover) : undefined;

  return (
    <div className="chart" ref={ref}>
      <div style={{ maxHeight: 340, overflowY: 'auto', overflowX: 'hidden' }}>
        <svg width={width} height={height} role="img" aria-label="Species evolution tree">
          <g className="axis">
            <line className="gridline" x1={sx(t1)} x2={sx(t1)} y1={PAD.t - 4} y2={height - PAD.b + 2} />
            <text x={PAD.l} y={height - 5}>{fmtTickTime(t0)}</text>
            <text x={sx(t1)} y={height - 5} textAnchor="end">now</text>
          </g>
          {layout.order.map((s) => {
            const i = layout.row.get(s.id)!;
            const end = s.extinctTick ?? now;
            const alive = s.extinctTick === null;
            const pr = layout.row.get(s.parentId);
            const dim = hover !== null && hover !== s.id;
            return (
              <g key={s.id} opacity={dim ? 0.45 : 1} style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)} onClick={() => onSelect?.(s.id)}>
                <rect x={0} y={sy(i) - ROW / 2} width={width} height={ROW} fill="transparent" />
                {pr !== undefined && (
                  <path d={`M${sx(s.originTick)},${sy(pr)}V${sy(i)}`} stroke={s.color} strokeOpacity={0.55} strokeWidth={1.5} fill="none" />
                )}
                <line x1={sx(s.originTick)} x2={sx(end)} y1={sy(i)} y2={sy(i)} stroke={s.color} strokeWidth={2} strokeOpacity={alive ? 1 : 0.35} strokeLinecap="round" />
                {alive ? (
                  <circle cx={sx(end)} cy={sy(i)} r={3 + 4 * Math.sqrt(s.population / maxPop)} fill={s.color} stroke="var(--panel-solid)" strokeWidth={2} />
                ) : (
                  <line x1={sx(end) - 3} x2={sx(end) + 3} y1={sy(i) - 4} y2={sy(i) + 4} stroke="var(--text-3)" strokeWidth={1.5} />
                )}
                <text x={sx(t1) + 10} y={sy(i) + 3.5} fill={alive ? 'var(--text-1)' : 'var(--text-3)'} fontSize={11}>
                  {s.common.length > 17 ? `${s.common.slice(0, 16)}…` : s.common}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {hov && (
        <div className="tooltip" style={{ left: 8, top: 4 }}>
          <div className="t-row"><i style={{ background: hov.color }} /><b style={{ minWidth: 0 }}>{hov.common}</b></div>
          <div className="t-head" style={{ marginTop: 3 }}><em>{hov.name}</em></div>
          <div className="t-head">{hov.origin === 'primordial' ? 'Primordial species' : hov.origin === 'introduced' ? `Introduced ${fmtDate(hov.originTick)}` : `Emerged ${fmtDate(hov.originTick)}`}</div>
          <div className="t-head">{hov.extinctTick !== null ? `Extinct ${fmtDate(hov.extinctTick)} · peak ${hov.peak}` : `${hov.population} alive · peak ${hov.peak}`}</div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon, Leaf, CloudRain, Tag } from 'lucide-react';
import { useUI } from '../client/store';
import { getRenderer } from './WorldView';
import { EventIcon } from './EventIcon';
import { selectEvent } from './Dashboard';
import { fmtDate } from './charts/common';
import type { SimEvent } from '../engine/types';

const MM_W = 224, MM_H = 140;

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const overlays = useUI((s) => s.overlays);
  const set = useUI((s) => s.set);
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 120) return;
      last = t;
      const r = getRenderer(), cv = ref.current;
      if (r && cv) r.drawMinimap(cv);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const jump = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = getRenderer();
    const cv = ref.current;
    if (!r || !cv) return;
    const rect = cv.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    r.camera.flyTo(fx * r.camera.worldW, fy * r.camera.worldH);
    set({ follow: false });
  };
  const toggle = (k: keyof typeof overlays) => set({ overlays: { ...overlays, [k]: !overlays[k] } });
  return (
    <div className="minimap panel">
      <canvas ref={ref} width={MM_W * 2} height={MM_H * 2} style={{ width: MM_W, height: MM_H }} onClick={jump} aria-label="Minimap — click to move the camera" />
      <div className="minimap-tools" role="group" aria-label="Map layers">
        <button className="btn ghost sm" aria-pressed={overlays.territory} onClick={() => toggle('territory')} title="Territories" style={{ color: overlays.territory ? 'var(--accent)' : undefined }}><MapIcon size={13} />Borders</button>
        <button className="btn ghost sm" aria-pressed={overlays.vegetation} onClick={() => toggle('vegetation')} title="Vegetation stress" style={{ color: overlays.vegetation ? 'var(--accent)' : undefined }}><Leaf size={13} />Flora</button>
        <button className="btn ghost sm" aria-pressed={overlays.weather} onClick={() => toggle('weather')} title="Weather" style={{ color: overlays.weather ? 'var(--accent)' : undefined }}><CloudRain size={13} />Sky</button>
        <button className="btn ghost sm" aria-pressed={overlays.labels} onClick={() => toggle('labels')} title="Labels" style={{ color: overlays.labels ? 'var(--accent)' : undefined }}><Tag size={13} />Names</button>
      </div>
    </div>
  );
}

/** Live ticker of notable events, newest at the bottom; each fades out after a while. */
export function EventTicker() {
  const events = useUI((s) => s.events);
  const [shown, setShown] = useState<{ e: SimEvent; at: number }[]>([]);
  const lastId = useRef(0);
  useEffect(() => {
    const fresh = events.filter((e) => e.id > lastId.current && (e.level >= 2 || e.cat === 'god'));
    if (events.length) lastId.current = Math.max(lastId.current, events[events.length - 1].id);
    if (fresh.length === 0) return;
    const now = performance.now();
    setShown((s) => [...s, ...fresh.slice(-3).map((e) => ({ e, at: now }))].slice(-4));
  }, [events]);
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = performance.now();
      setShown((s) => (s.some((x) => now - x.at > 14000) ? s.filter((x) => now - x.at <= 14000) : s));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="ticker" aria-live="polite">
      {shown.map(({ e }) => (
        <button key={e.id} className="tick-item panel" onClick={() => selectEvent(e)} title={e.x !== undefined ? 'Show on map' : undefined}>
          <EventIcon cat={e.cat} />
          <span>
            <b>{e.title}<small>{fmtDate(e.tick)}</small></b>
            <p>{e.text}</p>
          </span>
        </button>
      ))}
    </div>
  );
}

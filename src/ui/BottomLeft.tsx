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
        <span className="minimap-label">Layers</span>
        {([
          ['territory', 'Territory borders', MapIcon],
          ['vegetation', 'Vegetation stress', Leaf],
          ['weather', 'Weather', CloudRain],
          ['labels', 'Place names', Tag],
        ] as const).map(([k, label, Icon]) => (
          <button key={k} className="layer-btn" aria-pressed={overlays[k]} onClick={() => toggle(k)} title={label} aria-label={label}>
            <Icon size={14} />
          </button>
        ))}
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
    // A new or loaded world restarts event numbering: forget the old world's ticker.
    const newest = events.length ? events[events.length - 1].id : 0;
    if (newest < lastId.current) {
      lastId.current = 0;
      setShown([]);
    }
    const fresh = events.filter((e) => e.id > lastId.current && (e.level >= 2 || e.cat === 'god'));
    if (events.length) lastId.current = Math.max(lastId.current, events[events.length - 1].id);
    if (fresh.length === 0) return;
    const now = performance.now();
    setShown((s) => {
      const add = fresh.slice(-3).filter((e) => !s.some((x) => x.e.id === e.id)).map((e) => ({ e, at: now }));
      return [...s, ...add].slice(-4);
    });
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

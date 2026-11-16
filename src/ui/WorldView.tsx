import { useEffect, useRef } from 'react';
import { WorldRenderer } from '../render/renderer';
import { useUI, ToolId } from '../client/store';
import { getClient } from './client';
import type { GodCommand } from '../engine/types';

let rendererRef: WorldRenderer | null = null;
export function getRenderer(): WorldRenderer | null {
  return rendererRef;
}

const TOOL_RADIUS: Partial<Record<ToolId, number>> = {
  smite: 3, food: 6, blight: 6, rain: 14, storm: 12, snow: 14, earthquake: 20, meteor: 10, volcano: 8,
  wildfire: 3, plague: 7, raise: 5, lower: 5, spawn: 3,
};
const TOOL_COLOR: Partial<Record<ToolId, string>> = {
  smite: 'rgba(170,200,255,0.9)', food: 'rgba(120,230,110,0.9)', blight: 'rgba(170,110,220,0.9)', rain: 'rgba(120,180,255,0.9)',
  storm: 'rgba(160,160,200,0.9)', snow: 'rgba(235,240,255,0.9)', earthquake: 'rgba(230,170,100,0.9)', meteor: 'rgba(255,150,60,0.9)',
  volcano: 'rgba(255,90,40,0.9)', wildfire: 'rgba(255,130,40,0.9)', plague: 'rgba(160,230,70,0.9)', raise: 'rgba(200,190,160,0.9)',
  lower: 'rgba(90,150,200,0.9)', spawn: 'rgba(86,230,200,0.9)',
};

export function toolCommand(tool: ToolId, x: number, y: number): GodCommand | null {
  const st = useUI.getState();
  switch (tool) {
    case 'spawn':
      return st.spawnSpeciesId !== null
        ? { type: 'spawn', x, y, count: 8, speciesId: st.spawnSpeciesId }
        : { type: 'spawn', x, y, count: 10, template: st.spawnTemplate };
    case 'smite': return { type: 'smite', x, y, radius: 3 };
    case 'food': return { type: 'food', x, y, radius: 6, amount: 8 };
    case 'blight': return { type: 'food', x, y, radius: 6, amount: -1 };
    case 'rain': return { type: 'weather', x, y, kind: 'rain' };
    case 'storm': return { type: 'weather', x, y, kind: 'storm' };
    case 'snow': return { type: 'weather', x, y, kind: 'snow' };
    case 'earthquake': return { type: 'earthquake', x, y, magnitude: 7 };
    case 'meteor': return { type: 'meteor', x, y };
    case 'volcano': return { type: 'volcano', x, y };
    case 'wildfire': return { type: 'wildfire', x, y };
    case 'plague': return { type: 'plague', x, y };
    case 'raise': return { type: 'terraform', x, y, radius: 5, delta: 0.05 };
    case 'lower': return { type: 'terraform', x, y, radius: 5, delta: -0.05 };
    default: return null;
  }
}

export function WorldView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tool = useUI((s) => s.tool);
  const overlays = useUI((s) => s.overlays);
  const selected = useUI((s) => s.selectedCreature);
  const follow = useUI((s) => s.follow);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new WorldRenderer(canvas, getClient());
    rendererRef = r;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__wz = { renderer: r, client: getClient(), ui: useUI };
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => r.resize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    r.resize(wrap.clientWidth, wrap.clientHeight);
    r.start();
    return () => {
      ro.disconnect();
      r.stop();
      rendererRef = null;
    };
  }, []);

  useEffect(() => {
    const r = rendererRef;
    if (!r) return;
    r.overlays = overlays;
  }, [overlays]);

  useEffect(() => {
    const r = rendererRef;
    if (!r) return;
    r.selectedId = selected;
    r.followSelected = follow;
  }, [selected, follow]);

  useEffect(() => {
    const r = rendererRef;
    if (!r) return;
    r.brushRadius = TOOL_RADIUS[tool] ?? 0;
    r.brushColor = TOOL_COLOR[tool] ?? 'rgba(86,230,200,0.8)';
  }, [tool]);

  // Pointer interaction: drag to pan, wheel to zoom, click to use the active tool.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let down: { x: number; y: number; moved: boolean; button: number } | null = null;
    let last = { x: 0, y: 0 };
    const pos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onDown = (e: MouseEvent) => {
      const p = pos(e);
      down = { ...p, moved: false, button: e.button };
      last = p;
    };
    const onMove = (e: MouseEvent) => {
      const r = rendererRef;
      if (!r) return;
      const p = pos(e);
      if (down) {
        const dx = p.x - last.x, dy = p.y - last.y;
        if (Math.abs(p.x - down.x) + Math.abs(p.y - down.y) > 4) down.moved = true;
        if (down.moved) {
          r.camera.pan(dx, dy);
          if (useUI.getState().follow) useUI.getState().set({ follow: false });
        }
      }
      last = p;
      r.updateHover(p.x, p.y);
      canvas.style.cursor = down?.moved ? 'grabbing' : r.hoverId !== null && useUI.getState().tool === 'inspect' ? 'pointer' : useUI.getState().tool === 'inspect' ? 'grab' : 'crosshair';
    };
    const onUp = (e: MouseEvent) => {
      const r = rendererRef;
      if (!r || !down) return;
      const p = pos(e);
      if (!down.moved && down.button === 0) {
        const st = useUI.getState();
        if (st.tool === 'inspect') {
          const hit = r.pick(p.x, p.y);
          if (hit.kind === 'creature') {
            st.set({ selectedCreature: hit.id, creature: null });
            getClient().select(hit.id);
          } else if (hit.kind === 'settlement') {
            st.set({ selectedTribe: hit.tribeId ?? null, panel: 'civ', panelOpen: true });
          } else {
            st.set({ selectedCreature: null, creature: null, follow: false });
            getClient().select(null);
          }
        } else {
          const [wx, wy] = r.camera.screenToWorld(p.x, p.y);
          const cmd = toolCommand(st.tool, wx, wy);
          if (cmd) getClient().command(cmd);
        }
      }
      down = null;
    };
    const onLeave = () => {
      down = null;
      if (rendererRef) rendererRef.mouse = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = rendererRef;
      if (!r) return;
      const p = pos(e);
      r.camera.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="world-view" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="World map" />
    </div>
  );
}

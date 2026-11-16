import { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Save, Trash2 } from 'lucide-react';
import { useUI } from '../client/store';
import { SCENARIOS, ScenarioConfig } from '../engine/scenarios';
import { randomSeedString } from '../engine/rng';
import { getClient } from './client';
import { loadCustomScenarios, saveCustomScenario, deleteCustomScenario, clearAutosave } from '../client/persistence';
import { EventIcon } from './EventIcon';
import { selectEvent } from './EventRow';
import { fmtDate } from './charts/common';
import { TICKS_PER_DAY } from '../engine/constants';
import { Rng } from '../engine/rng';
import { generateWorld, DEFAULT_WORLDGEN, classifyBiomes } from '../engine/world/worldgen';
import { BIOMES } from '../engine/world/biomes';

/** Thumbnail of the real planet this scenario + seed will generate (same seeded generator as the simulation). */
const thumbCache = new Map<string, ImageData>();
let thumbQueue: Promise<void> = Promise.resolve();

function paintThumb(sc: ScenarioConfig, seed: string): ImageData {
  const key = `${seed}|${JSON.stringify(sc.world)}|${sc.settings.tempOffset}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const world = generateWorld({ ...DEFAULT_WORLDGEN, ...sc.world }, new Rng(seed).fork(1));
  if (sc.settings.tempOffset !== 0) classifyBiomes(world, sc.settings.tempOffset);
  const W = world.width, H = world.height;
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let [r, g, b] = BIOMES[world.biome[i]].color;
      if (world.river[i] && world.biome[i] > 3) { r = 70; g = 135; b = 175; }
      const e = world.elevation[i], el = world.elevation[Math.max(0, i - W - 1)];
      const shade = world.biome[i] > 3 ? 1 + Math.max(-0.35, Math.min(0.35, (el - e) * 10)) : 1;
      const o = i * 4;
      img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
    }
  }
  thumbCache.set(key, img);
  if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value!);
  return img;
}

function WorldThumb({ sc, seed }: { sc: ScenarioConfig; seed: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const t = window.setTimeout(() => {
      // Generate one card at a time so the dialog stays responsive.
      thumbQueue = thumbQueue.then(() => new Promise<void>((resolve) => {
        window.setTimeout(() => {
          if (!cancelled && ref.current) {
            const img = paintThumb(sc, seed);
            const g = ref.current.getContext('2d')!;
            ref.current.width = img.width;
            ref.current.height = img.height;
            g.putImageData(img, 0, 0);
            setReady(true);
          }
          resolve();
        }, 0);
      }));
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [sc, seed]);
  return (
    <span className="scenario-art" aria-hidden="true">
      <canvas ref={ref} style={{ opacity: ready ? 1 : 0 }} />
    </span>
  );
}

export function NewWorldDialog() {
  const open = useUI((s) => s.scenarioDialog);
  const current = useUI((s) => s.scenario);
  const env = useUI((s) => s.env);
  const set = useUI((s) => s.set);
  const notify = useUI((s) => s.notify);
  const ref = useRef<HTMLDialogElement>(null);
  const [custom, setCustom] = useState<ScenarioConfig[]>(() => loadCustomScenarios());
  const [pick, setPick] = useState<string>('primordial');
  const [seed, setSeed] = useState(randomSeedString());
  const [name, setName] = useState('');
  const all = useMemo(() => [...SCENARIOS, ...custom], [custom]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setSeed(randomSeedString()); setPick(current?.id && all.some((s) => s.id === current.id) ? current.id : 'primordial'); }
    if (!open && d.open) d.close();
  }, [open]);
  const chosen = all.find((s) => s.id === pick) ?? SCENARIOS[0];
  const start = (useSeed: string, base: ScenarioConfig = chosen) => {
    void clearAutosave();
    set({ scenarioDialog: false, loading: { label: 'Forging a new world…', progress: 0 }, ready: false });
    const sc = structuredClone(base);
    getClient().newWorld(sc, useSeed.trim() || randomSeedString());
  };
  const saveCurrentAsScenario = () => {
    if (!current || !env) return;
    const label = name.trim() || `${current.name} variant`;
    const sc: ScenarioConfig = {
      ...structuredClone(current),
      id: `custom-${Date.now()}`,
      name: label,
      tagline: 'Custom scenario',
      description: `Saved from ${current.name}: ${env.tempOffset >= 0 ? '+' : ''}${env.tempOffset.toFixed(1)}°C, rainfall ${Math.round(env.rainMult * 100)}%, food ${Math.round(env.foodMult * 100)}%, mutation ${Math.round(env.mutationRate * 100)}%, disasters ${env.disasterRate.toFixed(1)}×.`,
      settings: { ...current.settings, tempOffset: env.tempOffset, rainMult: env.rainMult, foodMult: env.foodMult, mutationRate: env.mutationRate, disasterRate: env.disasterRate },
      custom: true,
      seed: useUI.getState().seed,
    };
    setCustom(saveCustomScenario(sc));
    setPick(sc.id);
    setName('');
    notify(`Scenario “${label}” saved.`);
  };
  return (
    <dialog ref={ref} className="sheet" onClose={() => set({ scenarioDialog: false })} onCancel={() => set({ scenarioDialog: false })}>
      <div className="sheet-head">
        <div>
          <h2>Create a world</h2>
          <p>Every seed grows a different planet. Pick a scenario to set the starting conditions.</p>
        </div>
        <button className="btn ghost" onClick={() => set({ scenarioDialog: false })}>Cancel</button>
      </div>
      <div className="sheet-body">
        <div className="scenario-grid">
          {all.map((s) => (
            <button key={s.id} className="scenario" aria-pressed={pick === s.id} onClick={() => { setPick(s.id); if (s.seed) setSeed(s.seed); }} onDoubleClick={() => start(seed)}>
              <WorldThumb sc={s} seed={seed} />
              <span className="scenario-text">
                <b>{s.name}</b>
                <em>{s.tagline}</em>
                <p>{s.description}</p>
              </span>
            </button>
          ))}
        </div>
        {custom.some((c) => c.id === pick) && (
          <div style={{ marginTop: 10, textAlign: 'right' }}>
            <button className="btn sm danger" onClick={() => { setCustom(deleteCustomScenario(pick)); setPick('primordial'); }}><Trash2 size={13} />Delete this custom scenario</button>
          </div>
        )}
      </div>
      <div className="sheet-foot">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="seed">World seed</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id="seed" className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: 210 }} spellCheck={false} />
              <button className="btn icon" onClick={() => setSeed(randomSeedString())} aria-label="Random seed" title="Random seed"><Dices size={15} /></button>
            </div>
          </div>
          {current && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="scname">Save current settings as a scenario</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input id="scname" className="input" placeholder={`${current.name} variant`} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
                <button className="btn" onClick={saveCurrentAsScenario}><Save size={14} />Save</button>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {current && <button className="btn" onClick={() => start(useUI.getState().seed, current)} title="Same scenario and seed, from the beginning">Restart this world</button>}
          <button className="btn primary" onClick={() => start(seed)}>Create {chosen.name}</button>
        </div>
      </div>
    </dialog>
  );
}

export function AwayDialog() {
  const away = useUI((s) => s.away);
  const set = useUI((s) => s.set);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (away && !d.open) d.showModal();
    if (!away && d.open) d.close();
  }, [away]);
  if (!away) return <dialog ref={ref} className="sheet" />;
  const days = away.ticks / TICKS_PER_DAY;
  const delta = away.popAfter - away.popBefore;
  return (
    <dialog ref={ref} className="sheet" style={{ width: 'min(620px, calc(100vw - 48px))' }} onClose={() => set({ away: null })}>
      <div className="sheet-head">
        <div>
          <h2>While you were away</h2>
          <p>{days.toFixed(1)} days passed in your world. The population went from {away.popBefore} to {away.popAfter} ({delta >= 0 ? '+' : ''}{delta}).</p>
        </div>
      </div>
      <div className="sheet-body">
        {away.events.length === 0 ? <div className="empty">A quiet time: nothing of note happened.</div> : (
          <div className="away-list">
            {away.events.slice(-40).reverse().map((e) => (
              <div key={e.id} className={`ev lvl-${e.level}`}>
                <button className="ev-main" onClick={() => { set({ away: null }); selectEvent(e); }}>
                  <EventIcon cat={e.cat} />
                  <span><b>{e.title}</b><small>{fmtDate(e.tick)}</small><p>{e.text}</p></span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sheet-foot" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={() => set({ away: null })}>Return to the world</button>
      </div>
    </dialog>
  );
}

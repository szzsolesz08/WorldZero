import { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Save, Trash2 } from 'lucide-react';
import { useUI } from '../client/store';
import { SCENARIOS, ScenarioConfig } from '../engine/scenarios';
import { randomSeedString } from '../engine/rng';
import { getClient } from './client';
import { loadCustomScenarios, saveCustomScenario, deleteCustomScenario, clearAutosave } from '../client/persistence';
import { EventIcon } from './EventIcon';
import { selectEvent } from './Dashboard';
import { fmtDate } from './charts/common';
import { TICKS_PER_DAY } from '../engine/constants';

/** Small generative banner per scenario: a band of terrain colours with a mood. */
function ScenarioArt({ id }: { id: string }) {
  const palettes: Record<string, string[]> = {
    primordial: ['#123a5c', '#2f6d7a', '#6e9c58', '#3f7a46', '#9c8a62'],
    eden: ['#1d4f6e', '#3f8f6c', '#79b85c', '#3d8a3f', '#b8c46a'],
    survival: ['#5a4630', '#a07d4a', '#c9a66b', '#8a6a3c', '#d9bf8a'],
    iceage: ['#2a3e58', '#8fa9c4', '#d5e3ef', '#eef4fa', '#9fb6cc'],
    predators: ['#2a1418', '#6a2a2a', '#3f6a3c', '#8e3a2e', '#51402e'],
    islands: ['#0e2c4c', '#1d5576', '#3e8e8a', '#d4c48a', '#1d5576'],
    civilization: ['#1f3550', '#5f8a54', '#c9a95e', '#8e6d3e', '#d8c08a'],
    apocalypse: ['#1a0d0d', '#5a1d14', '#c2461f', '#ef8a3a', '#3a2620'],
  };
  const p = palettes[id] ?? ['#1a2a3a', '#3a5a6a', '#6a8a7a', '#4a6a5a', '#8a9a8a'];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pts = Array.from({ length: 9 }, (_, i) => 30 + ((h >> (i * 3)) & 15) * 1.6 + Math.sin(i * 1.3 + h) * 6);
  const path = `M0,74 ${pts.map((y, i) => `L${(i / 8) * 260},${y}`).join(' ')} L260,74 Z`;
  return (
    <svg className="scenario-art" viewBox="0 0 260 74" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={p[0]} /><stop offset="1" stopColor={p[1]} /></linearGradient></defs>
      <rect width="260" height="74" fill={`url(#sky-${id})`} />
      <path d={path} fill={p[2]} opacity="0.9" />
      <path d={`M0,74 ${pts.map((y, i) => `L${(i / 8) * 260 + 14},${y + 14}`).join(' ')} L260,74 Z`} fill={p[3]} />
      <rect y="66" width="260" height="8" fill={p[4]} opacity="0.5" />
    </svg>
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
              <ScenarioArt id={s.custom ? 'primordial' : s.id} />
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
              <button key={e.id} className={`ev lvl-${e.level}`} onClick={() => { set({ away: null }); selectEvent(e); }}>
                <EventIcon cat={e.cat} />
                <span><b>{e.title}</b><small>{fmtDate(e.tick)}</small><p>{e.text}</p></span>
              </button>
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

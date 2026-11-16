import { Pause, Play, Globe2, Save, FolderOpen, Download, Upload, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useRef } from 'react';
import { useUI, SPEEDS } from '../client/store';
import { applySpeed, getClient, autosaveNow } from './client';
import { SEASON_NAMES } from '../engine/constants';
import { exportStateFile, importStateFile, readSlot, writeSlot } from '../client/persistence';
import { fmtNum } from './charts/common';

function Mark() {
  return (
    <svg className="wordmark-mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d="M5 19 C 11 14, 21 22, 27 13" fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="3.4" fill="var(--accent)" />
    </svg>
  );
}

/** Day/night dial: the sun or moon travels around the rim; the band shows the season. */
function Dial({ dayPhase, daylight, season }: { dayPhase: number; daylight: number; season: number }) {
  const a = dayPhase * Math.PI * 2 + Math.PI / 2;
  const x = 15 + Math.cos(a) * 10, y = 15 + Math.sin(a) * 10;
  const seasonCol = ['#8fd694', '#f0c35a', '#e08a4a', '#a9c7ef'][season];
  return (
    <svg className="clock-dial" viewBox="0 0 30 30" aria-hidden="true">
      <circle cx="15" cy="15" r="13.5" fill="none" stroke="var(--rule-strong)" />
      <path d={`M15 15 L15 1.5 A13.5 13.5 0 0 1 ${15 + 13.5 * Math.sin((season + 1) * Math.PI / 2)} ${15 - 13.5 * Math.cos((season + 1) * Math.PI / 2)} Z`} fill={seasonCol} opacity="0.16" />
      <circle cx="15" cy="15" r="7" fill={`rgba(${20 + daylight * 60}, ${30 + daylight * 90}, ${60 + daylight * 110}, 0.9)`} />
      <circle cx={x} cy={y} r="3" fill={daylight > 0.25 ? '#ffd27a' : '#dfe8ff'} />
    </svg>
  );
}

export function TopBar() {
  const env = useUI((s) => s.env);
  const speed = useUI((s) => s.speed);
  const paused = useUI((s) => s.paused);
  const tps = useUI((s) => s.measuredTps);
  const summary = useUI((s) => s.summary);
  const scenarioName = useUI((s) => s.scenarioName);
  const seed = useUI((s) => s.seed);
  const panelOpen = useUI((s) => s.panelOpen);
  const set = useUI((s) => s.set);
  const notify = useUI((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);

  const setSpeed = (sp: (typeof SPEEDS)[number]) => {
    set({ speed: sp, paused: false });
    applySpeed();
  };
  const togglePause = () => {
    set({ paused: !useUI.getState().paused });
    applySpeed();
  };
  const quickSave = async () => {
    const state = await getClient().save();
    await writeSlot('quick', state, state.creatures.length, `${scenarioName} — ${seed}`);
    await autosaveNow();
    notify('World saved. Load it any time with Load.');
  };
  const quickLoad = async () => {
    const rec = await readSlot('quick');
    if (!rec) { notify('No saved world yet — use Save first.'); return; }
    set({ loading: { label: 'Restoring saved world…', progress: 0 } });
    getClient().load(rec.state, 0);
  };
  const doExport = async () => {
    const state = await getClient().save();
    exportStateFile(state, `world-zero-${seed}-y${Math.floor(state.tick / 4800) + 1}.json`);
  };
  const doImport = async (f: File) => {
    try {
      const state = await importStateFile(f);
      set({ loading: { label: 'Importing world…', progress: 0 } });
      getClient().load(state, 0);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  const daylight = env?.daylight ?? 1;
  return (
    <header className="topbar">
      <div className="wordmark">
        <Mark />
        <span className="wordmark-text">WORLD ZERO</span>
        <span className="wordmark-sub" title={`Seed ${seed}`}>{scenarioName} · <span className="mono">{seed}</span></span>
      </div>
      <div className="topbar-sep" />
      {env && (
        <div className="clock" title={`Global temperature offset ${env.globalTemp >= 0 ? '+' : ''}${env.globalTemp.toFixed(1)}°C`}>
          <Dial dayPhase={env.dayPhase} daylight={daylight} season={env.season} />
          <div>
            <div className="clock-main num">Year {env.year} · {SEASON_NAMES[env.season]} {env.day}</div>
            <div className="clock-sub num">{daylight > 0.55 ? 'Day' : daylight > 0.2 ? (env.dayPhase < 0.5 ? 'Dawn' : 'Dusk') : 'Night'} · {env.avgTemp.toFixed(1)}°C mean{env.droughtDays > 0 ? ` · drought ${env.droughtDays}d` : ''}</div>
          </div>
        </div>
      )}
      <div className="transport" role="group" aria-label="Simulation speed">
        <button onClick={togglePause} aria-pressed={paused} aria-label={paused ? 'Resume' : 'Pause'} title="Pause / resume (Space)">
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        {SPEEDS.map((sp, i) => (
          <button key={sp} onClick={() => setSpeed(sp)} aria-pressed={!paused && speed === sp} title={`${sp}× speed (${i + 1})`}>{sp}×</button>
        ))}
        <span className="tps num" title="Simulated ticks per second (actual)">{paused ? 'paused' : `${Math.round(tps)} t/s`}</span>
      </div>
      <div className="spacer" />
      {summary && (
        <div className="topbar-stats">
          <div className="topbar-stat"><b className="num">{fmtNum(summary.population)}</b><span>creatures</span></div>
          <div className="topbar-stat"><b className="num">{summary.speciesAlive}</b><span>species</span></div>
          <div className="topbar-stat"><b className="num">{summary.tribes}</b><span>tribes</span></div>
        </div>
      )}
      <div className="topbar-sep" />
      <button className="btn primary" onClick={() => set({ scenarioDialog: true })} title="Generate a new world or choose a scenario (N)">
        <Globe2 size={14} /> New world
      </button>
      <button className="btn icon" onClick={quickSave} title="Save world" aria-label="Save world"><Save size={14} /></button>
      <button className="btn icon" onClick={quickLoad} title="Load saved world" aria-label="Load saved world"><FolderOpen size={14} /></button>
      <button className="btn icon" onClick={doExport} title="Export world to a file" aria-label="Export world to a file"><Download size={14} /></button>
      <button className="btn icon" onClick={() => fileRef.current?.click()} title="Import world from a file" aria-label="Import world from a file"><Upload size={14} /></button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }} />
      <button className="btn icon ghost" onClick={() => set({ panelOpen: !panelOpen })} aria-label={panelOpen ? 'Hide dashboard' : 'Show dashboard'} title="Toggle dashboard (Tab)">
        {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
    </header>
  );
}

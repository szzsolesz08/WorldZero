import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useUI, SPEEDS } from '../client/store';
import { getClient, applySpeed, autosaveNow } from './client';
import { readAutosave } from '../client/persistence';
import { getScenario } from '../engine/scenarios';
import { randomSeedString } from '../engine/rng';
import { WorldView, getRenderer } from './WorldView';
import { TopBar } from './TopBar';
import { GodRail } from './GodRail';
import { Dashboard } from './Dashboard';
import { Inspector } from './Inspector';
import { Minimap, EventTicker } from './BottomLeft';
import { NewWorldDialog, AwayDialog } from './Dialogs';

let booted = false;

async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  const client = getClient();
  const save = await readAutosave();
  if (save) {
    const away = Math.max(0, Date.now() - save.savedAt);
    useUI.getState().set({ loading: { label: 'Waking your world…', progress: 0 } });
    try {
      client.load(save.state, away);
      return;
    } catch {
      /* fall through to a fresh world */
    }
  }
  useUI.getState().set({ loading: { label: 'Forging a new world…', progress: 0 } });
  client.newWorld(getScenario('primordial')!, randomSeedString());
}

function Loading() {
  const loading = useUI((s) => s.loading);
  if (!loading) return null;
  const determinate = loading.progress > 0;
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading-card">
        <span className="wordmark-text">WORLD ZERO</span>
        <p>{loading.label}</p>
        <div className={`progress${determinate ? '' : ' indeterminate'}`}><div style={{ width: `${Math.round(loading.progress * 100)}%` }} /></div>
      </div>
    </div>
  );
}

function Toast() {
  const toast = useUI((s) => s.toast);
  const set = useUI((s) => s.set);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => set({ toast: null }), 3200);
    return () => window.clearTimeout(t);
  }, [toast, set]);
  if (!toast) return null;
  return <div className="toast panel" role="status" key={toast.id}>{toast.text}</div>;
}

function ErrorBanner() {
  const error = useUI((s) => s.error);
  const set = useUI((s) => s.set);
  if (!error) return null;
  return (
    <div className="error-banner panel" role="alert">
      <span>The simulation reported a problem: {error}</span>
      <button className="btn sm" onClick={() => { set({ error: null, scenarioDialog: true }); }}>Start a new world</button>
      <button className="btn icon ghost" onClick={() => set({ error: null })} aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}

export function App() {
  const inspecting = useUI((s) => s.selectedCreature !== null);
  useEffect(() => {
    void boot();
    const auto = window.setInterval(() => void autosaveNow(), 45000);
    const onHide = () => { if (document.visibilityState === 'hidden') void autosaveNow(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(auto);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      const st = useUI.getState();
      const r = getRenderer();
      const pan = 60;
      switch (e.key) {
        case ' ': e.preventDefault(); st.set({ paused: !st.paused }); applySpeed(); break;
        case '1': case '2': case '3': case '4': st.set({ speed: SPEEDS[Number(e.key) - 1], paused: false }); applySpeed(); break;
        case 'Escape':
          if (st.tool !== 'inspect') st.set({ tool: 'inspect' });
          else { st.set({ selectedCreature: null, creature: null, follow: false }); getClient().select(null); }
          break;
        case 'f': case 'F': if (st.selectedCreature !== null) st.set({ follow: !st.follow }); break;
        case 'Tab': e.preventDefault(); st.set({ panelOpen: !st.panelOpen }); break;
        case 'n': case 'N': st.set({ scenarioDialog: true }); break;
        case 'w': case 'ArrowUp': r?.camera.pan(0, pan); break;
        case 's': case 'ArrowDown': r?.camera.pan(0, -pan); break;
        case 'a': case 'ArrowLeft': r?.camera.pan(pan, 0); break;
        case 'd': case 'ArrowRight': r?.camera.pan(-pan, 0); break;
        case '+': case '=': r?.camera.zoomAt(1.25, r.camera.viewW / 2, r.camera.viewH / 2); break;
        case '-': case '_': r?.camera.zoomAt(0.8, r.camera.viewW / 2, r.camera.viewH / 2); break;
        case '0': r?.camera.fit(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app${inspecting ? ' inspecting' : ''}`}>
      <WorldView />
      <TopBar />
      <GodRail />
      <Inspector />
      <Dashboard />
      <Minimap />
      <EventTicker />
      <Toast />
      <ErrorBanner />
      <Loading />
      <NewWorldDialog />
      <AwayDialog />
    </div>
  );
}

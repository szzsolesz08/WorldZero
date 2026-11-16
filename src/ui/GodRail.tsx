import {
  MousePointer2, Sparkles, Zap, Sprout, Skull, CloudRain, CloudLightning, Snowflake, Activity, Flame, Biohazard, Mountain,
  ArrowDownToLine, ArrowUpFromLine, Rocket, Wand2,
} from 'lucide-react';
import { useState } from 'react';
import { useUI, ToolId } from '../client/store';
import { TEMPLATES } from '../engine/scenarios';
import { getClient } from './client';

interface ToolDef { id: ToolId; label: string; hint: string; icon: typeof Zap }

const GROUPS: ToolDef[][] = [
  [{ id: 'inspect', label: 'Inspect', hint: 'Select creatures and settlements', icon: MousePointer2 }],
  [
    { id: 'spawn', label: 'Create life', hint: 'Place a herd of creatures', icon: Sparkles },
    { id: 'smite', label: 'Smite', hint: 'Divine lightning removes creatures', icon: Zap },
    { id: 'food', label: 'Bless the land', hint: 'Grow abundant vegetation', icon: Sprout },
    { id: 'blight', label: 'Blight', hint: 'Wither vegetation', icon: Skull },
  ],
  [
    { id: 'rain', label: 'Rain', hint: 'Summon a rain cloud', icon: CloudRain },
    { id: 'storm', label: 'Storm', hint: 'Summon a violent storm', icon: CloudLightning },
    { id: 'snow', label: 'Snow', hint: 'Summon a snowstorm', icon: Snowflake },
  ],
  [
    { id: 'earthquake', label: 'Earthquake', hint: 'Shake and reshape the land (M7)', icon: Activity },
    { id: 'meteor', label: 'Meteor', hint: 'Impact crater, fires and dust winter', icon: Rocket },
    { id: 'volcano', label: 'Volcano', hint: 'Raise a volcano and spread ash', icon: Mountain },
    { id: 'wildfire', label: 'Wildfire', hint: 'Ignite dry vegetation', icon: Flame },
    { id: 'plague', label: 'Plague', hint: 'Start an epidemic', icon: Biohazard },
  ],
  [
    { id: 'raise', label: 'Raise land', hint: 'Lift terrain; can create land bridges', icon: ArrowUpFromLine },
    { id: 'lower', label: 'Lower land', hint: 'Sink terrain; can flood land', icon: ArrowDownToLine },
  ],
];

export function GodRail() {
  const tool = useUI((s) => s.tool);
  const set = useUI((s) => s.set);
  const [powers, setPowers] = useState(false);
  return (
    <>
      <nav className="rail panel" aria-label="God tools">
        {GROUPS.map((g, gi) => (
          <div className="rail-group" key={gi}>
            {g.map((t) => (
              <button key={t.id} className="rail-btn" aria-pressed={tool === t.id} aria-label={t.label}
                onClick={() => { set({ tool: tool === t.id && t.id !== 'inspect' ? 'inspect' : t.id }); setPowers(false); }}>
                <t.icon size={17} strokeWidth={1.9} />
                <span className="tip">{t.label}<small>{t.hint}</small></span>
              </button>
            ))}
          </div>
        ))}
        <div className="rail-group">
          <button className="rail-btn" aria-pressed={powers} aria-label="World powers" onClick={() => setPowers(!powers)}>
            <Wand2 size={17} strokeWidth={1.9} />
            <span className="tip">World powers<small>Global events and new species</small></span>
          </button>
        </div>
      </nav>
      {tool === 'spawn' && !powers && <SpawnOptions />}
      {powers && <Powers onClose={() => setPowers(false)} />}
    </>
  );
}

function SpawnOptions() {
  const template = useUI((s) => s.spawnTemplate);
  const speciesId = useUI((s) => s.spawnSpeciesId);
  const species = useUI((s) => s.species);
  const set = useUI((s) => s.set);
  const alive = species.filter((s) => s.extinctTick === null && s.population > 0).sort((a, b) => b.population - a.population).slice(0, 8);
  return (
    <div className="flyout panel" role="dialog" aria-label="Create life">
      <h3>Create life</h3>
      <p>Click the map to place a herd. New archetypes become new species; existing species add members.</p>
      <div className="option-list">
        {Object.values(TEMPLATES).map((t) => (
          <button key={t.id} className="option" aria-pressed={speciesId === null && template === t.id}
            onClick={() => set({ spawnTemplate: t.id, spawnSpeciesId: null })}>
            <span className="swatch" style={{ background: `hsl(${Math.round((t.genes.hue ?? 0.5) * 360)}, 65%, 60%)` }} />
            <span>{t.label}<small>{t.description}</small></span>
            <span />
          </button>
        ))}
      </div>
      {alive.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Existing species</h3>
          <div className="option-list">
            {alive.map((s) => (
              <button key={s.id} className="option" aria-pressed={speciesId === s.id} onClick={() => set({ spawnSpeciesId: s.id })}>
                <span className="swatch" style={{ background: s.color }} />
                <span>{s.common}<small><em>{s.name}</em></small></span>
                <span className="muted num">{s.population}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Powers({ onClose }: { onClose: () => void }) {
  const notify = useUI((s) => s.notify);
  const c = getClient();
  const act = (fn: () => void, msg: string) => { fn(); notify(msg); };
  return (
    <div className="flyout panel" role="dialog" aria-label="World powers">
      <h3>World powers</h3>
      <p>Events that affect the whole planet at once.</p>
      <div className="action-grid">
        <button className="btn" onClick={() => act(() => c.command({ type: 'drought', days: 8 }), 'A drought begins.')}>Drought</button>
        <button className="btn" onClick={() => act(() => c.command({ type: 'globalStorm' }), 'Storms sweep the world.')}>Global storms</button>
        <button className="btn" onClick={() => act(() => c.command({ type: 'iceAge' }), 'The world begins to freeze.')}>Ice age</button>
        <button className="btn" onClick={() => act(() => c.command({ type: 'climateShift', trend: 3, limit: 10 }), 'A warming trend begins.')}>Global warming</button>
        <button className="btn" onClick={() => act(() => c.command({ type: 'climateShift', trend: 0, limit: 0 }), 'Climate trend halted.')}>Halt climate trend</button>
        <button className="btn" onClick={() => act(() => c.command({ type: 'clearWeather' }), 'The skies clear.')}>Clear skies</button>
        <button className="btn" onClick={() => act(() => c.command({ type: 'addRandom', count: 60 }), '60 creatures added to existing species.')}>Add 60 creatures</button>
        <button className="btn danger" onClick={() => act(() => c.command({ type: 'cull', percent: 30 }), 'A blight takes 30% of all life.')}>Cull 30%</button>
      </div>
      <h3 style={{ marginTop: 16 }}>Introduce a species</h3>
      <p>A new species appears somewhere hospitable.</p>
      <div className="action-grid">
        {['random', 'sapient', 'pack_hunter', 'stalker', 'giant', 'amphibian', 'arctic', 'desert'].map((t) => (
          <button key={t} className="btn" onClick={() => act(() => c.command({ type: 'introduceSpecies', template: t, count: t === 'pack_hunter' || t === 'stalker' ? 14 : 30 }), 'A new species has appeared.')}>
            {t === 'random' ? 'Random mutant' : TEMPLATES[t].label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 12, textAlign: 'right' }}><button className="btn ghost sm" onClick={onClose}>Close</button></div>
    </div>
  );
}

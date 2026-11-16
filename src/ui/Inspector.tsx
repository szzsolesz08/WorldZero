import { useEffect, useRef } from 'react';
import { X, Crosshair, LocateFixed, HeartPulse } from 'lucide-react';
import { useUI } from '../client/store';
import { getClient } from './client';
import { flyTo } from './Dashboard';
import { creatureSprite } from '../render/sprites';
import { GENE_LABELS, GENES } from '../engine/creatures/genome';
import { fmtDate } from './charts/common';
import type { FamilyNode, CreatureDetail } from '../engine/types';

const ACTION_LABEL: Record<string, string> = {
  wander: 'Wandering', graze: 'Feeding', hunt: 'Hunting', scavenge: 'Scavenging', drink: 'Drinking', flee: 'Fleeing',
  mate: 'Courting', rest: 'Resting', socialize: 'Socializing', explore: 'Exploring', follow: 'Following', defend: 'Defending',
  work: 'Working', eat_store: 'Eating', return: 'Going home', dead: 'Deceased',
};

function selectCreature(id: number): void {
  useUI.getState().set({ selectedCreature: id, creature: null });
  getClient().select(id);
}

function Portrait({ c }: { c: CreatureDetail }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, 112, 112);
    const spr = creatureSprite(c.hue, c.saturation, c.pattern, c.diet, c.shape);
    g.save();
    g.translate(56, 58);
    g.rotate(-0.35);
    const s = 1.3 + Math.min(0.5, c.size * 0.12);
    g.scale(s, s);
    if (!c.alive) g.globalAlpha = 0.45;
    g.drawImage(spr, -32, -32);
    g.restore();
  }, [c.hue, c.saturation, c.pattern, c.diet, c.shape, c.size, c.alive]);
  return <div className="portrait"><canvas ref={ref} width={112} height={112} style={{ width: 56, height: 56 }} aria-hidden="true" /></div>;
}

function Bar({ label, value, max, color, text }: { label: string; value: number; max: number; color: string; text: string }) {
  return (
    <div>
      <div className="vital-label"><span>{label}</span><b>{text}</b></div>
      <div className="meter"><div style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: color }} /></div>
    </div>
  );
}

function FamilyChip({ n, self = false }: { n: FamilyNode; self?: boolean }) {
  return (
    <button className="chip" onClick={() => !self && selectCreature(n.id)} disabled={self}
      style={{ cursor: self ? 'default' : 'pointer', opacity: n.alive || self ? 1 : 0.55, borderColor: self ? 'var(--accent)' : undefined }}
      title={n.alive ? 'Alive — click to inspect' : 'Deceased — click to read their story'}>
      <span className="swatch" style={{ width: 8, height: 8, background: `hsl(${Math.round(n.hue * 360)}, 65%, 60%)` }} />
      {n.name}{!n.alive && !self ? ' (dead)' : ''}
    </button>
  );
}

function Family({ f }: { f: FamilyNode }) {
  const grand = f.parents.flatMap((p) => p.parents);
  const grandkids = f.children.reduce((a, c) => a + c.children.length, 0);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {grand.length > 0 && <div><div className="muted" style={{ fontSize: 11 }}>Grandparents</div><div className="chips">{grand.map((g) => <FamilyChip key={g.id} n={g} />)}</div></div>}
      {f.parents.length > 0 ? (
        <div><div className="muted" style={{ fontSize: 11 }}>Parents</div><div className="chips">{f.parents.map((p) => <FamilyChip key={p.id} n={p} />)}</div></div>
      ) : <div className="muted" style={{ fontSize: 11.5 }}>A first-generation creature — no known parents.</div>}
      <div className="chips"><FamilyChip n={f} self /></div>
      {f.children.length > 0 ? (
        <div><div className="muted" style={{ fontSize: 11 }}>Children{grandkids ? ` · ${grandkids} grandchildren` : ''}</div><div className="chips">{f.children.map((c) => <FamilyChip key={c.id} n={c} />)}</div></div>
      ) : <div className="muted" style={{ fontSize: 11.5 }}>No offspring yet.</div>}
    </div>
  );
}

export function Inspector() {
  const id = useUI((s) => s.selectedCreature);
  const c = useUI((s) => s.creature);
  const follow = useUI((s) => s.follow);
  const set = useUI((s) => s.set);
  const species = useUI((s) => s.species);
  if (id === null) return null;
  const close = () => { set({ selectedCreature: null, creature: null, follow: false }); getClient().select(null); };
  if (!c) {
    return (
      <aside className="inspector panel" aria-label="Creature inspector">
        <div className="insp-head"><div className="portrait" /><div className="insp-name"><h2>Loading…</h2></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close inspector"><X size={16} /></button></div>
      </aside>
    );
  }
  const sp = species.find((s) => s.id === c.speciesId);
  const ageFrac = c.ageDays / c.lifespanDays;
  const stage = !c.alive ? 'deceased' : c.ageDays < c.maturityDays ? 'juvenile' : ageFrac > 0.85 ? 'elder' : 'adult';
  return (
    <aside className="inspector panel" aria-label="Creature inspector">
      <div className="insp-head">
        <Portrait c={c} />
        <div className="insp-name">
          {c.title && <span className="title">{c.title}</span>}
          <h2>{c.name}</h2>
          <p title={c.speciesName}>{c.speciesCommon} · <em>{c.speciesName}</em></p>
        </div>
        <button className="btn icon ghost" onClick={close} aria-label="Close inspector"><X size={16} /></button>
      </div>
      <div className="insp-actions">
        <button className="btn sm" aria-pressed={follow} disabled={!c.alive} onClick={() => set({ follow: !follow })}
          style={follow ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
          <Crosshair size={13} />{follow ? 'Following' : 'Follow'}
        </button>
        <button className="btn sm" onClick={() => flyTo(c.x, c.y, 12)}><LocateFixed size={13} />Locate</button>
        <button className="btn sm" disabled={!c.alive} onClick={() => getClient().command({ type: 'bless', creatureId: c.id })} title="Heal and feed this creature">
          <HeartPulse size={13} />Bless
        </button>
      </div>
      <div className="insp-body">
        <div className={`goal${c.alive ? '' : ' dead'}`}>
          {(!c.alive || (ACTION_LABEL[c.action] ?? c.action) !== c.goal) && (
            <small>{c.alive ? `${ACTION_LABEL[c.action] ?? c.action}${c.job && c.action === 'work' ? ` · ${c.job}` : ''}` : `Died ${c.deathTick !== null ? fmtDate(c.deathTick) : ''}`}</small>
          )}
          {c.alive ? c.goal : `Cause: ${c.causeOfDeath}`}
        </div>
        <section className="section">
          <dl className="kv">
            <dt>Sex · stage</dt><dd>{c.sex} · {stage}</dd>
            <dt>Age</dt><dd>{c.ageDays.toFixed(1)} of ~{c.lifespanDays.toFixed(0)} days</dd>
            <dt>Generation</dt><dd>{c.generation}</dd>
            <dt>Born</dt><dd>{fmtDate(c.birthTick)}</dd>
            {c.alive && <><dt>Location</dt><dd>{c.biome}{c.landmass ? `, ${c.landmass}` : ''}</dd></>}
            {c.tribe && <><dt>Tribe</dt><dd><button className="table-toggle" onClick={() => set({ selectedTribe: c.tribe!.id, panel: 'civ', panelOpen: true })}>{c.tribe.name}</button></dd></>}
            {c.home && <><dt>Home</dt><dd>{c.home.name}</dd></>}
            <dt>Travelled</dt><dd>{Math.round(c.distance)} leagues · {Math.round(c.maxTravel)} from birthplace</dd>
            <dt>Offspring · kills</dt><dd>{c.children} · {c.kills}</dd>
          </dl>
        </section>
        {c.alive && (
          <section className="section">
            <div className="vitals">
              <Bar label="Health" value={c.health} max={c.maxHealth} color={c.health / c.maxHealth < 0.35 ? 'var(--danger)' : 'var(--good)'} text={`${Math.round((c.health / c.maxHealth) * 100)}%`} />
              <Bar label="Energy" value={c.energy} max={c.maxEnergy} color={c.energy / c.maxEnergy < 0.3 ? 'var(--amber)' : 'var(--series-3)'} text={`${Math.round((c.energy / c.maxEnergy) * 100)}%`} />
              <Bar label="Hydration" value={c.hydration} max={1} color={c.hydration < 0.3 ? 'var(--amber)' : 'var(--series-1)'} text={`${Math.round(c.hydration * 100)}%`} />
              <Bar label={`Temp · ${c.comfortLow.toFixed(0)}–${c.comfortHigh.toFixed(0)}° ok`} value={c.temperature - (c.comfortLow - 10)} max={c.comfortHigh - c.comfortLow + 20}
                color={c.temperature < c.comfortLow || c.temperature > c.comfortHigh ? 'var(--danger)' : 'var(--series-2)'}
                text={`${c.temperature.toFixed(0)}°C`} />
            </div>
            {c.infected && <div className="chip war" style={{ marginTop: 8 }}>Infected with plague</div>}
          </section>
        )}
        <section className="section">
          <div className="section-head"><h2>Personality</h2></div>
          {c.personality.map((p) => (
            <div className="trait" key={p.label}>
              <span className="t-label">{p.label}</span>
              <span className="t-track"><span className="t-fill" style={{ width: `${p.value * 100}%`, background: 'var(--accent)', opacity: 0.8 }} /></span>
              <span className="t-val">{p.value.toFixed(2)}</span>
            </div>
          ))}
        </section>
        <section className="section">
          <div className="section-head"><h2>Genome</h2><span className="aside">tick = species mean</span></div>
          {GENES.slice(0, 16).map((g) => (
            <div className="trait" key={g}>
              <span className="t-label">{GENE_LABELS[g]}</span>
              <span className="t-track">
                <span className="t-fill" style={{ width: `${c.genes[g] * 100}%`, background: sp?.color ?? 'var(--series-1)', opacity: 0.85 }} />
                {sp && <span className="t-mark" style={{ left: `calc(${sp.traits[g] * 100}% - 1px)` }} />}
              </span>
              <span className="t-val">{c.genes[g].toFixed(2)}</span>
            </div>
          ))}
        </section>
        <section className="section">
          <div className="section-head"><h2>Family</h2></div>
          <Family f={c.family} />
        </section>
        <section className="section">
          <div className="section-head"><h2>Relationships</h2></div>
          {c.relations.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No bonds formed.</div> : (
            <div className="rows">
              {c.relations.slice(0, 10).map((r) => (
                <button className="row" key={r.id} onClick={() => selectCreature(r.id)} style={{ gridTemplateColumns: '1fr auto' }}>
                  <span className="r-name"><b style={{ opacity: r.alive ? 1 : 0.55 }}>{r.name}</b><small>{r.kind}{r.alive ? '' : ' · deceased'}</small></span>
                  <span className="r-val num" style={{ color: r.affinity < 0 ? 'var(--danger)' : 'var(--text-2)' }}>{r.affinity > 0 ? '+' : ''}{r.affinity.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="section">
          <div className="section-head"><h2>Life story</h2></div>
          <ul className="timeline">
            {c.memories.slice().reverse().map((m, i) => (
              <li key={i} className={`k-${m.kind}`}>{m.text}<small>{fmtDate(m.tick)}</small></li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

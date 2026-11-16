import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Dna, Landmark, Leaf, ScrollText, LocateFixed } from 'lucide-react';
import { useUI, PanelId } from '../client/store';
import { LineChart } from './charts/LineChart';
import { SpeciesStack } from './charts/SpeciesStack';
import { PhyloTree } from './charts/PhyloTree';
import { fmtNum, fmtDate, hsl } from './charts/common';
import { getClient, selectCreature, selectSettlement } from './client';
import { EventRow, selectEvent } from './EventRow';
import { GOAL_LABEL, POLICY_LABEL, POLICY_DELAY } from '../engine/civ/strategy';
import { STATE_LABEL } from '../engine/civ/settlements';
import { TICKS_PER_DAY } from '../engine/constants';
import { POLICY_KEYS } from '../engine/types';
import { getRenderer } from './WorldView';
import { TECHS } from '../engine/civ/tech';
import { GENE_LABELS } from '../engine/creatures/genome';
import type { SimEvent, SpeciesView, TribeView, SimParamKey } from '../engine/types';

const TABS: { id: PanelId; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'World', icon: Activity },
  { id: 'evolution', label: 'Evolution', icon: Dna },
  { id: 'civ', label: 'Civs', icon: Landmark },
  { id: 'environment', label: 'Climate', icon: Leaf },
  { id: 'chronicle', label: 'Chronicle', icon: ScrollText },
];

export function flyTo(x: number, y: number, zoom = 9): void {
  const r = getRenderer();
  if (!r) return;
  r.camera.flyTo(x, y, Math.max(r.camera.zoom, zoom));
  useUI.getState().set({ follow: false });
}

export function Dashboard() {
  const panel = useUI((s) => s.panel);
  const open = useUI((s) => s.panelOpen);
  const set = useUI((s) => s.set);
  return (
    <aside className={`dash panel${open ? '' : ' closed'}`} aria-label="Dashboard">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={panel === t.id} onClick={() => set({ panel: t.id, panelOpen: true })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="dash-body" role="tabpanel">
        {panel === 'overview' && <Overview />}
        {panel === 'evolution' && <Evolution />}
        {panel === 'civ' && <Civilizations />}
        {panel === 'environment' && <Environment />}
        {panel === 'chronicle' && <Chronicle />}
      </div>
    </aside>
  );
}

function useHistory() {
  const h = useUI((s) => s.history);
  return h && h.tick && h.tick.length ? h : null;
}

function Objectives() {
  const objectives = useUI((s) => s.objectives);
  if (!objectives.length) return null;
  const done = objectives.filter((o) => o.status === 'complete').length;
  return (
    <section className="section">
      <div className="section-head"><h2>Objectives</h2><span className="aside">{done} of {objectives.length} achieved</span></div>
      <div className="objectives">
        {objectives.map((o) => (
          <div key={o.id} className={`objective s-${o.status}`}>
            <div className="vital-label">
              <span>{o.label}</span>
              <b>{o.status === 'complete' ? 'Achieved' : o.status === 'failed' ? 'Failed' : `${Math.round(o.progress * 100)}%`}</b>
            </div>
            <div className="meter"><div style={{ width: `${o.progress * 100}%`, background: o.status === 'failed' ? 'var(--danger)' : o.status === 'complete' ? 'var(--good)' : 'var(--text-2)' }} /></div>
            <small>{o.detail}{o.completedTick !== null ? ` · ${fmtDate(o.completedTick)}` : ''}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Overview

function Overview() {
  const s = useUI((st) => st.summary);
  const h = useHistory();
  const species = useUI((st) => st.species);
  const [open, setOpen] = useState<number | null>(null);
  if (!s) return <div className="empty">Waiting for the first census…</div>;
  const pop = h?.population ?? [];
  const prev = pop.length > 3 ? pop[pop.length - 3] : pop[0] ?? s.population;
  const delta = s.population - prev;
  const alive = species.filter((x) => x.extinctTick === null && x.population > 0).sort((a, b) => b.population - a.population);
  const total = Math.max(1, s.population);
  const perDay = (arr: number[]) => arr.map((v) => v * 2);
  const change = pop.length > 3 ? `${delta >= 0 ? '+' : ''}${fmtNum(delta)} today` : undefined;
  return (
    <>
      <Objectives />
      <section className="section">
        {h ? (
          <LineChart title={`Population · ${fmtNum(s.population)} living`} aside={change} x={h.tick}
            series={[{ key: 'pop', label: 'Population', color: 'var(--series-1)', values: h.population }]} />
        ) : (
          <div className="section-head"><h2>Population · {fmtNum(s.population)} living</h2></div>
        )}
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Species alive</dt><dd>{s.speciesAlive} of {s.speciesTotal} ever</dd>
          <dt>Births · deaths per day</dt><dd>{fmtNum(s.births * 2)} · {fmtNum(s.deaths * 2)}</dd>
          <dt>Average lifespan</dt><dd>{s.avgLifespanDays.toFixed(1)} days</dd>
          <dt>Biodiversity</dt><dd>{s.biodiversity.toFixed(2)} effective species</dd>
          <dt>Mean intelligence</dt><dd>{s.avgIntelligence.toFixed(2)}</dd>
          <dt>Civilizations</dt><dd>{s.tribes} tribes · {s.settlements} settlements</dd>
          <dt>Deepest generation</dt><dd>{s.maxGeneration}</dd>
          {s.infected > 0 && <><dt>Infected with plague</dt><dd style={{ color: 'var(--danger)' }}>{s.infected}</dd></>}
        </dl>
      </section>
      {h && (
        <section className="section">
          <LineChart title="Births and deaths" aside="per day" x={h.tick} area={false}
            series={[
              { key: 'b', label: 'Births', color: 'var(--series-3)', values: perDay(h.births) },
              { key: 'd', label: 'Deaths', color: 'var(--series-2)', values: perDay(h.deaths) },
            ]} />
        </section>
      )}
      <section className="section">
        <div className="section-head"><h2>Diet</h2><span className="aside">trophic levels</span></div>
        <div className="seg-bar" role="img" aria-label={`Herbivores ${s.herbivores}, omnivores ${s.omnivores}, carnivores ${s.carnivores}`}>
          {[['var(--series-3)', s.herbivores], ['var(--series-1)', s.omnivores], ['var(--series-2)', s.carnivores]].map(([c, v], i) =>
            (v as number) > 0 ? <div key={i} style={{ flexGrow: v as number, background: c as string }} /> : null)}
        </div>
        <div className="legend">
          <span><i className="box" style={{ background: 'var(--series-3)' }} />Herbivores <b className="num">{s.herbivores}</b></span>
          <span><i className="box" style={{ background: 'var(--series-1)' }} />Omnivores <b className="num">{s.omnivores}</b></span>
          <span><i className="box" style={{ background: 'var(--series-2)' }} />Carnivores <b className="num">{s.carnivores}</b></span>
        </div>
      </section>
      <section className="section">
        <div className="section-head"><h2>Species</h2><span className="aside">share of population</span></div>
        {alive.length === 0 ? (
          <div className="empty"><b>No life remains.</b> Open World powers on the left rail and introduce a species to begin again.</div>
        ) : (
          <div className="rows">
            {alive.map((sp) => (
              <div key={sp.id}>
                <button className="row" onClick={() => setOpen(open === sp.id ? null : sp.id)} aria-expanded={open === sp.id}>
                  <span className="swatch" style={{ background: sp.color }} />
                  <span className="r-name"><b>{sp.common}</b><small><em>{sp.name}</em> · {sp.diet}{sp.sapient ? ' · sapient' : ''}</small></span>
                  <span className="r-val num">{sp.population}<small>{((sp.population / total) * 100).toFixed(0)}%</small></span>
                </button>
                {open === sp.id && <SpeciesDetail sp={sp} />}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

const TRAITS = ['size', 'speed', 'perception', 'strength', 'intelligence', 'sociability', 'aggression', 'fertility', 'longevity', 'coldTol', 'heatTol', 'diet', 'swim', 'nocturnal'] as const;

function SpeciesDetail({ sp }: { sp: SpeciesView }) {
  const species = useUI((s) => s.species);
  const parent = species.find((p) => p.id === sp.parentId);
  return (
    <div style={{ padding: '6px 6px 10px 27px' }}>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
        {sp.origin === 'primordial' ? 'Primordial species' : sp.origin === 'introduced' ? 'Introduced by divine will' : `Descended from ${parent?.common ?? 'an extinct line'}`}
        {' '}· {fmtDate(sp.originTick)} · peak {sp.peak} · {sp.totalBorn} born · gen {sp.generationMax}
      </div>
      {TRAITS.map((k) => (
        <div className="trait" key={k}>
          <span className="t-label">{GENE_LABELS[k]}</span>
          <span className="t-track"><span className="t-fill" style={{ width: `${sp.traits[k] * 100}%`, background: sp.color, opacity: 0.85 }} /></span>
          <span className="t-val">{sp.traits[k].toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Evolution

function Evolution() {
  const h = useHistory();
  const species = useUI((s) => s.species);
  const sh = useUI((s) => s.speciesHistory);
  const s = useUI((st) => st.summary);
  const env = useUI((st) => st.env);
  if (!h || !s) return <div className="empty">Waiting for the first census…</div>;
  const extinct = species.filter((x) => x.extinctTick !== null).length;
  const emerged = species.filter((x) => x.origin === 'speciation' || x.origin === 'allopatric').length;
  const traits: [string, string][] = [
    ['avgSize', 'Body size'], ['avgSpeed', 'Speed'], ['avgIntelligence', 'Intelligence'], ['avgPerception', 'Perception'],
    ['avgColdTol', 'Cold tolerance'], ['avgHeatTol', 'Heat tolerance'], ['avgDiet', 'Carnivory'],
  ];
  return (
    <>
      <section className="section">
        <dl className="facts">
          <div className="fact"><dt>Genetic diversity</dt><dd className="num">{s.geneticDiversity.toFixed(3)}</dd></div>
          <div className="fact"><dt>Mutations / birth</dt><dd className="num">{s.mutationsPerBirth.toFixed(2)}</dd></div>
          <div className="fact"><dt>Generations</dt><dd className="num">{s.maxGeneration}</dd></div>
          <div className="fact"><dt>New species</dt><dd className="num">{emerged}</dd></div>
          <div className="fact"><dt>Extinctions</dt><dd className="num">{extinct}</dd></div>
          <div className="fact"><dt>Lineages ever</dt><dd className="num">{species.length}</dd></div>
        </dl>
      </section>
      <section className="section">
        <SpeciesStack x={h.tick} speciesHistory={sh} species={species} />
      </section>
      <section className="section">
        <div className="section-head"><h2>Tree of life</h2><span className="aside">branches from origin to today</span></div>
        <PhyloTree species={species} now={env?.tick ?? 0} />
      </section>
      <section className="section">
        <div className="section-head"><h2>Trait evolution</h2><span className="aside">population mean, 0–1</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
          {traits.map(([k, label]) => (
            <LineChart key={k} title={label} x={h.tick} height={70} domain={[0, 1]} format={(v) => v.toFixed(2)}
              series={[{ key: k, label, color: 'var(--series-1)', values: h[k] ?? [] }]} />
          ))}
        </div>
      </section>
      <section className="section">
        <LineChart title="Genetic diversity" aside="mean per-gene std. dev." x={h.tick} format={(v) => v.toFixed(2)}
          series={[{ key: 'gd', label: 'Diversity', color: 'var(--series-3)', values: h.geneticDiversity }]} />
      </section>
      <section className="section">
        <LineChart title="Mutation frequency" aside="mutations per birth" x={h.tick} format={(v) => v.toFixed(1)}
          series={[{ key: 'mu', label: 'Mutations per birth', color: 'var(--series-2)', values: h.mutations }]} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Civilizations

function Civilizations() {
  const tribes = useUI((s) => s.tribes);
  const selected = useUI((s) => s.selectedTribe);
  const set = useUI((s) => s.set);
  const species = useUI((s) => s.species);
  const counters = useUI((s) => s.counters);
  const active = tribes.filter((t) => !t.collapsed).sort((a, b) => b.population - a.population);
  const fallen = tribes.filter((t) => t.collapsed).sort((a, b) => (b.collapsedTick ?? 0) - (a.collapsedTick ?? 0));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected !== null) ref.current?.querySelector(`[data-tribe="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  const wars = new Set<string>(), alliances = new Set<string>();
  for (const t of active) for (const r of t.relations) {
    const k = [t.id, r.tribeId].sort().join(':');
    if (r.status === 'war') wars.add(k);
    if (r.status === 'alliance') alliances.add(k);
  }
  if (tribes.length === 0) {
    return (
      <div className="empty" style={{ paddingTop: 18 }}>
        <b>No civilizations yet.</b><br />
        Tribes form when at least four intelligent (≥ 0.5), social creatures of one species gather. They then settle near water,
        research technology, farm, trade and fight.<br /><br />
        Start the <b>Civilization</b> scenario, or introduce a <b>Sapient</b> species from World powers on the left rail.
      </div>
    );
  }
  return (
    <div ref={ref}>
      <section className="section">
        <dl className="facts">
          <div className="fact"><dt>Civilizations</dt><dd className="num">{active.length}</dd></div>
          <div className="fact"><dt>Citizens</dt><dd className="num">{fmtNum(active.reduce((a, t) => a + t.population, 0))}</dd></div>
          <div className="fact"><dt>Settlements</dt><dd className="num">{active.reduce((a, t) => a + t.settlements, 0)}</dd></div>
          <div className="fact"><dt>Wars</dt><dd className="num">{wars.size}</dd></div>
          <div className="fact"><dt>Alliances</dt><dd className="num">{alliances.size}</dd></div>
          <div className="fact"><dt>Fallen</dt><dd className="num">{fallen.length}</dd></div>
        </dl>
      </section>
      {counters && counters.groups + counters.abandoned + counters.secessions > 0 && (
        <section className="section">
          <div className="section-head"><h2>Movements and change</h2><span className="aside">all time</span></div>
          <dl className="kv">
            <dt>On the road now</dt><dd>{active.reduce((a, t) => a + t.inTransit, 0)} people</dd>
            <dt>Journeys · arrived · lost</dt><dd>{counters.groups} · {counters.arrived} · {counters.lost}</dd>
            <dt>Migrants · refugees</dt><dd>{counters.migrants} · {counters.refugees}</dd>
            <dt>Stranded on the way</dt><dd>{counters.stranded}</dd>
            <dt>Settlements founded · colonies</dt><dd>{counters.founded} · {counters.colonies}</dd>
            <dt>Abandoned · resettled</dt><dd>{counters.abandoned} · {counters.resettled}</dd>
            <dt>Rebellions</dt><dd>{counters.secessions}</dd>
          </dl>
        </section>
      )}
      <section className="section">
        {active.map((t) => (
          <TribeCard key={t.id} t={t} open={selected === t.id} onToggle={() => set({ selectedTribe: selected === t.id ? null : t.id })}
            tribes={tribes} speciesName={species.find((s) => s.id === t.speciesId)?.common ?? ''} />
        ))}
      </section>
      {fallen.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Fallen civilizations</h2></div>
          <div className="rows">
            {fallen.slice(0, 12).map((t) => (
              <div className="row" key={t.id} style={{ cursor: 'default' }}>
                <span className="swatch" style={{ background: t.color, opacity: 0.5 }} />
                <span className="r-name"><b className="dim">{t.name}</b><small>{fmtDate(t.founded)} – {t.collapsedTick !== null ? fmtDate(t.collapsedTick) : '?'}</small></span>
                <span className="r-val num muted">peak {t.peak}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** A civilization's towns, read from the frame stream (state and population update live). */
function TribeSettlements({ ids, capitalId }: { ids: number[]; capitalId: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const frame = getClient().frame;
  const list = (frame?.settlements ?? []).filter((s) => ids.includes(s.id)).sort((a, b) => b.population - a.population);
  if (!list.length) return null;
  return (
    <>
      <h4>Settlements</h4>
      <div className="rows">
        {list.map((s) => (
          <button className="row" key={s.id} onClick={() => selectSettlement(s.id)} style={{ gridTemplateColumns: '1fr auto auto' }}>
            <span className="r-name"><b>{s.name}{s.id === capitalId ? ' · capital' : ''}</b><small>{['Camp', 'Village', 'Town', 'City'][s.tier]}</small></span>
            <span className={`chip st-${s.state}`}>{STATE_LABEL[s.state]}</span>
            <span className="r-val num">{s.population}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function TribeCard({ t, open, onToggle, tribes, speciesName }: { t: TribeView; open: boolean; onToggle: () => void; tribes: TribeView[]; speciesName: string }) {
  const now = useUI((s) => s.env?.tick ?? 0);
  const allEvents = useUI((s) => s.events);
  const known = new Set(t.techs);
  const parent = t.parentTribeId >= 0 ? tribes.find((x) => x.id === t.parentTribeId) : undefined;
  const recentIds = new Set(t.recentEvents);
  const recent = open ? allEvents.filter((e) => recentIds.has(e.id)).slice(-6).reverse() : [];
  return (
    <div className="tribe-card" data-tribe={t.id}>
      <button className="tribe-head" onClick={onToggle} aria-expanded={open}>
        <span className="swatch" style={{ background: t.color }} />
        <span className="r-name" style={{ minWidth: 0 }}>
          <b style={{ display: 'block', fontWeight: 600 }}>{t.name}</b>
          <small className="muted" style={{ fontSize: 11.5 }}>{t.archetype} {speciesName} · {t.government}</small>
        </span>
        <span className="r-val num" style={{ textAlign: 'right' }}>{t.population}<small className="muted" style={{ display: 'block', fontSize: 11 }}>{t.settlements} {t.settlements === 1 ? 'town' : 'towns'}</small></span>
      </button>
      {open && (
        <div className="tribe-body">
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button className="btn sm" onClick={() => flyTo(t.homeX, t.homeY, 8)}><LocateFixed size={13} />Locate</button>
            <button className="btn sm" onClick={() => selectCreature(t.leaderId)}>Leader: {t.leaderName}</button>
          </div>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Founded</dt><dd>{fmtDate(t.founded)}</dd>
            <dt>Capital</dt><dd>{t.capitalId >= 0 ? <button className="table-toggle" onClick={() => selectSettlement(t.capitalId)}>{t.capitalName}</button> : 'None (nomadic)'}</dd>
            <dt>Territory</dt><dd>{t.territory} tiles</dd>
            <dt>Peak population</dt><dd>{t.peak}</dd>
            <dt>Economy</dt><dd>{t.economy}</dd>
            <dt>Military strength</dt><dd>{t.military.toFixed(1)}</dd>
            <dt>Moved in · out · on the road</dt><dd>{t.migIn} · {t.migOut} · {t.inTransit}</dd>
            <dt>Stores</dt><dd>{t.stock.food} food · {t.stock.wood} wood · {t.stock.stone} stone{t.stock.ore ? ` · ${t.stock.ore} ore` : ''}</dd>
            {parent && <><dt>Broke away from</dt><dd>{parent.name}</dd></>}
            {t.successors.length > 0 && <><dt>Successor states</dt><dd>{t.successors.map((id) => tribes.find((x) => x.id === id)?.name ?? '?').join(', ')}</dd></>}
          </dl>
          <div className="vitals" style={{ marginTop: 10 }}>
            <div>
              <div className="vital-label"><span>Stability</span><b>{Math.round(t.stability * 100)}%</b></div>
              <div className="meter"><div style={{ width: `${t.stability * 100}%`, background: t.stability < 0.3 ? 'var(--danger)' : t.stability < 0.5 ? 'var(--amber)' : 'var(--good)' }} /></div>
            </div>
            <div>
              <div className="vital-label"><span>Food security</span><b>{Math.round(t.foodSecurity * 100)}%</b></div>
              <div className="meter"><div style={{ width: `${t.foodSecurity * 100}%`, background: t.foodSecurity < 0.4 ? 'var(--danger)' : t.foodSecurity < 0.55 ? 'var(--amber)' : 'var(--good)' }} /></div>
            </div>
          </div>
          {t.instability && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Unrest: {t.instability}.</div>}
          <h4>Priorities</h4>
          {t.goals.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>Still finding its way.</div> : (
            <ol className="goals">{t.goals.map((g, i) => <li key={g} className={i === 0 ? 'top' : undefined}>{GOAL_LABEL[g]}</li>)}</ol>
          )}
          <h4>Policies <span className="muted" style={{ fontWeight: 400 }}>· changes take {POLICY_DELAY / TICKS_PER_DAY} days and cost stability</span></h4>
          <div className="policies">
            {POLICY_KEYS.map((k) => {
              const pend = t.pendingPolicies.find((p) => p.key === k);
              const cur = t.policies[k] ?? 0;
              return (
                <div className="policy" key={k}>
                  <span className="p-label">{POLICY_LABEL[k]}</span>
                  <div className="seg" role="group" aria-label={`${POLICY_LABEL[k]} policy`}>
                    {([-1, 0, 1] as const).map((v) => (
                      <button key={v} aria-pressed={cur === v} className={pend?.value === v ? 'pending' : undefined}
                        onClick={() => getClient().command({ type: 'setPolicy', tribeId: t.id, key: k, value: v })}
                        title={pend?.value === v ? `Takes effect in ${Math.max(0, (pend.effectiveAt - now) / TICKS_PER_DAY).toFixed(1)} days` : undefined}>
                        {v === -1 ? 'Low' : v === 0 ? 'Balanced' : 'High'}
                      </button>
                    ))}
                  </div>
                  {pend && <small className="p-pend">→ {pend.value === -1 ? 'Low' : pend.value === 0 ? 'Balanced' : 'High'} in {Math.max(0, (pend.effectiveAt - now) / TICKS_PER_DAY).toFixed(1)} d</small>}
                </div>
              );
            })}
          </div>
          {t.settlementIds.length > 0 && <TribeSettlements ids={t.settlementIds} capitalId={t.capitalId} />}
          <h4>Culture</h4>
          {(['militarism', 'openness', 'scholarship', 'agrarian'] as const).map((k) => (
            <div className="trait" key={k}>
              <span className="t-label">{k[0].toUpperCase() + k.slice(1)}</span>
              <span className="t-track"><span className="t-fill" style={{ width: `${t.culture[k] * 100}%`, background: t.color }} /></span>
              <span className="t-val">{t.culture[k].toFixed(2)}</span>
            </div>
          ))}
          <h4>Technology · {t.techs.length}/{TECHS.length}{t.researching ? ` · researching ${TECHS.find((x) => x.id === t.researching)?.name} ${Math.round(t.researchProgress * 100)}%` : ''}</h4>
          <div className="chips">
            {TECHS.map((x) => (
              <span key={x.id} className={`chip tech${known.has(x.id) ? ' done' : x.id === t.researching ? ' now' : ''}`} title={x.description}>{x.name}</span>
            ))}
          </div>
          <h4>Traditions</h4>
          <div className="chips">{t.traditions.map((x) => <span className="chip" key={x}>{x}</span>)}</div>
          <h4>Relations</h4>
          {t.relations.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No contact with other civilizations yet.</div> : (
            <div className="rows">
              {t.relations.sort((a, b) => a.value - b.value).map((r) => {
                const o = tribes.find((x) => x.id === r.tribeId);
                if (!o) return null;
                return (
                  <div className="row" key={r.tribeId} style={{ cursor: 'default', gridTemplateColumns: '12px 1fr auto auto' }}>
                    <span className="swatch" style={{ background: o.color }} />
                    <span className="r-name"><b>{o.name}</b></span>
                    <span className="num muted" style={{ fontSize: 11.5 }}>{r.value > 0 ? '+' : ''}{r.value}</span>
                    <span className={`chip ${r.status}`}>{r.status === 'war' ? 'At war' : r.status === 'alliance' ? 'Allied' : 'At peace'}</span>
                  </div>
                );
              })}
            </div>
          )}
          {recent.length > 0 && (
            <>
              <h4>Recent history</h4>
              <div className="ev-list">{recent.map((e) => <EventRow key={e.id} e={e} compact />)}</div>
            </>
          )}
          {t.history.length > 2 && (
            <div style={{ marginTop: 10 }}>
              <LineChart title="Population" x={t.history.map((_, i) => t.founded + i * 300)} height={80}
                series={[{ key: 'p', label: 'Population', color: hsl(t.hue, 70, 60), values: t.history }]} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Environment

function Slider({ label, k, min, max, step, value, fmt }: { label: string; k: SimParamKey; min: number; max: number; step: number; value: number; fmt: (v: number) => string }) {
  const [v, setV] = useState(value);
  const timer = useRef<number | null>(null);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setV(value); }, [value]);
  const change = (nv: number) => {
    setV(nv);
    editing.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      getClient().command({ type: 'setParam', key: k, value: nv });
      editing.current = false;
    }, 120);
  };
  const id = `sl-${k}`;
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{fmt(v)}</output>
      <input id={id} type="range" min={min} max={max} step={step} value={v} onChange={(e) => change(Number(e.target.value))} />
    </div>
  );
}

function Environment() {
  const env = useUI((s) => s.env);
  const h = useHistory();
  const causes = useUI((s) => s.deathCauses);
  if (!env) return <div className="empty">Waiting for the first reading…</div>;
  const sortedCauses = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxCause = Math.max(1, ...sortedCauses.map((c) => c[1]));
  const health = env.ecoHealth;
  return (
    <>
      <section className="section">
        <dl className="facts">
          <div className="fact"><dt>Mean temp.</dt><dd className="num">{env.avgTemp.toFixed(1)}<small>°C</small></dd></div>
          <div className="fact"><dt>Climate shift</dt><dd className="num">{env.globalTemp >= 0 ? '+' : ''}{env.globalTemp.toFixed(1)}<small>°C</small></dd></div>
          <div className="fact"><dt>Rainfall</dt><dd className="num">{Math.round(env.rainfall * 100)}<small>%</small></dd></div>
          <div className="fact"><dt>Vegetation</dt><dd className="num">{Math.round(env.vegetation * 100)}<small>% of cap.</small></dd></div>
          <div className="fact"><dt>Burning</dt><dd className="num">{env.burning}<small>tiles</small></dd></div>
          <div className="fact"><dt>Drought</dt><dd className="num">{env.droughtDays > 0 ? `${env.droughtDays}` : '—'}<small>{env.droughtDays > 0 ? 'days left' : ''}</small></dd></div>
        </dl>
        <div style={{ marginTop: 12 }}>
          <div className="vital-label"><span>Ecosystem health</span><b>{health}/100</b></div>
          <div className="meter"><div style={{ width: `${health}%`, background: health > 60 ? 'var(--good)' : health > 35 ? 'var(--amber)' : 'var(--danger)' }} /></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Combines vegetation cover, biodiversity, population stability and predator–prey balance.</div>
        </div>
      </section>
      <section className="section">
        <div className="section-head"><h2>Conditions</h2><span className="aside">applies immediately</span></div>
        <Slider label="Global temperature" k="tempOffset" min={-20} max={20} step={0.5} value={env.tempOffset} fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°C`} />
        <Slider label="Rainfall" k="rainMult" min={0} max={2.5} step={0.05} value={env.rainMult} fmt={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Food abundance" k="foodMult" min={0.2} max={3} step={0.05} value={env.foodMult} fmt={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Mutation rate" k="mutationRate" min={0} max={0.4} step={0.01} value={env.mutationRate} fmt={(v) => `${(v * 100).toFixed(0)}% per gene`} />
        <Slider label="Natural disasters" k="disasterRate" min={0} max={5} step={0.1} value={Math.min(5, env.disasterRate)} fmt={(v) => (v === 0 ? 'Off' : `${v.toFixed(1)}×`)} />
      </section>
      {h && (
        <>
          <section className="section">
            <LineChart title="Mean temperature" aside="°C" x={h.tick} allowNegative format={(v) => v.toFixed(0)}
              series={[{ key: 't', label: 'Temperature', color: 'var(--series-2)', values: h.temperature }]} />
          </section>
          <section className="section">
            <LineChart title="Vegetation" aside="% of capacity" x={h.tick} domain={[0, 1]} format={(v) => `${Math.round(v * 100)}`}
              series={[{ key: 'v', label: 'Vegetation', color: 'var(--series-3)', values: h.vegetation }]} />
          </section>
          <section className="section">
            <LineChart title="Rainfall" aside="relative" x={h.tick} format={(v) => v.toFixed(1)}
              series={[{ key: 'r', label: 'Rainfall', color: 'var(--series-1)', values: h.rainfall }]} />
          </section>
          <section className="section">
            <LineChart title="Ecosystem health" x={h.tick} domain={[0, 100]}
              series={[{ key: 'e', label: 'Health', color: 'var(--series-3)', values: h.ecoHealth }]} />
          </section>
        </>
      )}
      <section className="section">
        <div className="section-head"><h2>Causes of death</h2><span className="aside">all time</span></div>
        {sortedCauses.length === 0 ? <div className="empty">No deaths yet.</div> : sortedCauses.map(([k, v]) => (
          <div className="trait" key={k} style={{ gridTemplateColumns: '110px 1fr 46px' }}>
            <span className="t-label" style={{ textTransform: 'capitalize' }}>{k}</span>
            <span className="t-track"><span className="t-fill" style={{ width: `${(v / maxCause) * 100}%`, background: 'var(--series-2)' }} /></span>
            <span className="t-val">{fmtNum(v)}</span>
          </div>
        ))}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Chronicle

const FILTERS: { id: string; label: string; match: (e: SimEvent) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'major', label: 'Major', match: (e) => e.level >= 3 },
  { id: 'life', label: 'Life', match: (e) => e.cat === 'species' || e.cat === 'evolution' || e.cat === 'creature' },
  { id: 'civ', label: 'Civilization', match: (e) => e.cat === 'civ' || e.cat === 'war' },
  { id: 'settle', label: 'Towns', match: (e) => e.cat === 'settlement' || e.cat === 'migration' },
  { id: 'disaster', label: 'Disasters', match: (e) => e.cat === 'disaster' || e.cat === 'climate' },
];

export { selectEvent };

function Chronicle() {
  const events = useUI((s) => s.events);
  const focus = useUI((s) => s.focusEvent);
  const [f, setF] = useState('all');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus !== null) setF('all'); }, [focus]);
  const list = useMemo(() => {
    const m = FILTERS.find((x) => x.id === f)!.match;
    return events.filter((e) => e.id === focus || (m(e) && (f !== 'all' || e.level >= 2 || e.cat === 'civ' || e.cat === 'settlement'))).slice().reverse().slice(0, 300);
  }, [events, f, focus]);
  useEffect(() => {
    if (focus === null) return;
    listRef.current?.querySelector(`[data-ev="${focus}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = window.setTimeout(() => useUI.getState().set({ focusEvent: null }), 2600);
    return () => window.clearTimeout(t);
  }, [focus, list]);
  return (
    <>
      <div style={{ padding: '12px 0 8px', position: 'sticky', top: 0, background: 'var(--panel-solid)', zIndex: 2 }}>
        <div className="seg" role="group" aria-label="Filter events">
          {FILTERS.map((x) => <button key={x.id} aria-pressed={f === x.id} onClick={() => setF(x.id)}>{x.label}</button>)}
        </div>
      </div>
      {list.length === 0 ? <div className="empty">Nothing recorded here yet. History is being written as you watch.</div> : (
        <div className="ev-list" ref={listRef}>
          {list.map((e) => <EventRow key={e.id} e={e} focused={e.id === focus} />)}
        </div>
      )}
    </>
  );
}

import { X, LocateFixed, Landmark, Tent, House, Building2, Castle } from 'lucide-react';
import { useUI } from '../client/store';
import { selectSettlement } from './client';
import { flyTo } from './Dashboard';
import { EventRow } from './EventRow';
import { LineChart } from './charts/LineChart';
import { fmtDate, fmtNum, hsl } from './charts/common';
import { STATE_LABEL } from '../engine/civ/settlements';
import { TICKS_PER_DAY } from '../engine/constants';
import type { MigrationGroupView, SettlementDetail } from '../engine/types';

const TIER_ICON = [Tent, House, Building2, Castle];

const PROBLEM: Record<string, string> = {
  famine: 'Hunger: people are not getting enough to eat',
  drought: 'Water is scarce',
  insecurity: 'Raids and enemies nearby keep people afraid',
  overcrowding: 'Too many people for the housing',
  unemployment: 'Not enough work for everyone',
  disease: 'Sickness is spreading',
};

const HOW: Record<string, string> = {
  founded: 'Founded', colonized: 'Colonized', refuge: 'Founded by refugees', resettled: 'Resettled', seceded: 'Seceded',
  conquered: 'Conquered',
};

/** Meter colour by threshold (status colours carry status, per DESIGN.md). */
function tone(v: number, warn = 0.45, bad = 0.25): string {
  return v < bad ? 'var(--danger)' : v < warn ? 'var(--amber)' : 'var(--good)';
}

function Meter({ label, frac, text, color }: { label: string; frac: number; text: string; color: string }) {
  return (
    <div>
      <div className="vital-label"><span>{label}</span><b>{text}</b></div>
      <div className="meter"><div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: color }} /></div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { economic: 'Migrants', refugee: 'Refugees', colonist: 'Colonists' };

function JourneyRow({ g, here }: { g: MigrationGroupView; here: number }) {
  const outgoing = g.originId === here;
  return (
    <button className="row journey" onClick={() => flyTo(g.x, g.y, 9)} title="Show the group on the map">
      <span className={`kind-dot k-${g.kind}`} style={g.kind === 'economic' ? { background: hsl(g.hue, 70, 64) } : undefined} />
      <span className="r-name">
        <b>{KIND_LABEL[g.kind]} · {g.size}</b>
        <small>{outgoing ? `to ${g.destName}` : `from ${g.originName}`} · {g.reason}{g.deaths ? ` · ${g.deaths} died on the way` : ''}</small>
        <span className="meter"><span style={{ display: 'block', height: '100%', width: `${g.progress * 100}%`, background: 'var(--text-2)', borderRadius: 4 }} /></span>
      </span>
      <span className="r-val num">{Math.round(g.progress * 100)}%</span>
    </button>
  );
}

export function SettlementInspector() {
  const id = useUI((s) => s.selectedSettlement);
  const d = useUI((s) => s.settlement);
  const set = useUI((s) => s.set);
  const now = useUI((s) => s.env?.tick ?? 0);
  if (id === null) return null;
  const close = () => selectSettlement(null);
  if (!d) {
    return (
      <aside className="inspector panel" aria-label="Settlement inspector">
        <div className="insp-head"><div className="portrait" /><div className="insp-name"><h2>Loading…</h2></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close inspector"><X size={16} /></button></div>
      </aside>
    );
  }
  return (
    <aside className="inspector panel" aria-label={`Settlement inspector: ${d.name}`}>
      <SettlementHead d={d} close={close} />
      <div className="insp-actions">
        <button className="btn sm" onClick={() => flyTo(d.x, d.y, 9)}><LocateFixed size={13} />Locate</button>
        <button className="btn sm" onClick={() => set({ selectedTribe: d.tribeId, panel: 'civ', panelOpen: true })}><Landmark size={13} />{d.tribeName}</button>
      </div>
      <div className="insp-body">
        <StatusCard d={d} now={now} />
        {d.abandonedTick === null ? <Living d={d} /> : <Remains d={d} />}
        {d.groups.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>On the road</h2><span className="aside">{d.groups.length} {d.groups.length === 1 ? 'journey' : 'journeys'}</span></div>
            <div className="rows">{d.groups.map((g) => <JourneyRow key={g.id} g={g} here={d.id} />)}</div>
          </section>
        )}
        {d.popHistory.length > 2 && (
          <section className="section">
            <LineChart title="Population" aside="daily" height={90}
              x={d.popHistory.map((_, i) => now - (d.popHistory.length - 1 - i) * TICKS_PER_DAY)}
              series={[{ key: 'p', label: 'Population', color: hsl(d.tribeHue, 70, 60), values: d.popHistory }]} />
          </section>
        )}
        <section className="section">
          <div className="section-head"><h2>History</h2><span className="aside">{d.eras.length} {d.eras.length === 1 ? 'era' : 'eras'}</span></div>
          <ul className="timeline">
            {d.eras.slice().reverse().map((e, i) => (
              <li key={i} className={e.end === null ? 'k-settle' : 'k-loss'}>
                {HOW[e.how] ?? e.how} by {e.tribeName}{e.peak ? ` · peak ${e.peak}` : ''}
                {e.endReason && <span className="muted"> — {e.endReason}</span>}
                <small>{fmtDate(e.start)}{e.end !== null ? ` – ${fmtDate(e.end)}` : ' – today'}</small>
              </li>
            ))}
          </ul>
        </section>
        <section className="section">
          <div className="section-head"><h2>Recorded events</h2></div>
          {d.events.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>Nothing notable has happened here yet.</div> : (
            <div className="ev-list">{d.events.map((e) => <EventRow key={e.id} e={e} compact />)}</div>
          )}
        </section>
      </div>
    </aside>
  );
}

function SettlementHead({ d, close }: { d: SettlementDetail; close: () => void }) {
  const Icon = TIER_ICON[Math.min(3, d.tier)] ?? Tent;
  const gone = d.abandonedTick !== null;
  return (
    <div className="insp-head">
      <div className={`portrait crest${gone ? ' gone' : ''}`} style={{ color: gone ? 'var(--text-3)' : hsl(d.tribeHue, 70, 66) }}>
        <Icon size={26} strokeWidth={1.75} />
      </div>
      <div className="insp-name">
        <h2>{d.name}<span className={`chip st-${d.state}`}>{STATE_LABEL[d.state]}</span></h2>
        <p>{gone ? `Former ${d.tierName.toLowerCase()} · last held by ${d.tribeName}` : `${d.tierName}${d.isCapital ? ' and capital' : ''} of ${d.tribeName}`}</p>
      </div>
      <button className="btn icon ghost" onClick={close} aria-label="Close inspector"><X size={16} /></button>
    </div>
  );
}

function StatusCard({ d, now }: { d: SettlementDetail; now: number }) {
  const since = Math.max(0, (now - d.stateSince) / TICKS_PER_DAY);
  const lastEra = d.eras[d.eras.length - 1];
  if (d.abandonedTick !== null) {
    return (
      <div className="goal dead">
        <small>{STATE_LABEL[d.state]} since {fmtDate(d.abandonedTick)}</small>
        {lastEra?.endReason ? `Abandoned: ${lastEra.endReason}.` : 'Abandoned.'} Its name and history remain; anyone may settle here again.
      </div>
    );
  }
  return (
    <div className={`goal${d.state === 'crisis' ? ' dead' : ''}`}>
      <small>{STATE_LABEL[d.state]} for {since < 1 ? 'less than a day' : `${since.toFixed(since < 10 ? 1 : 0)} days`} · economy {d.economy.toLowerCase()}</small>
      {d.mainProblem ? PROBLEM[d.mainProblem] ?? d.mainProblem : 'No pressing problems.'}
    </div>
  );
}

function Living({ d }: { d: SettlementDetail }) {
  const prosperity = (d.prosperity + 1) / 2;
  const housingFrac = d.housing > 0 ? d.population / d.housing : 0;
  const delta = d.populationChange;
  return (
    <>
      <section className="section">
        <dl className="kv">
          <dt>Population</dt><dd>{d.population}{delta !== 0 && <span style={{ color: delta > 0 ? 'var(--good)' : 'var(--danger)' }}> {delta > 0 ? '+' : ''}{delta} today</span>}</dd>
          <dt>Housing</dt><dd>{d.population} of {d.housing} places{housingFrac > 1 ? ' · overcrowded' : ''}</dd>
          <dt>Peak</dt><dd>{d.peak}</dd>
          <dt>Founded</dt><dd>{fmtDate(d.founded)}</dd>
          {d.parentName && <><dt>Colony of</dt><dd>{d.parentName}</dd></>}
        </dl>
      </section>
      <section className="section">
        <div className="section-head"><h2>Condition</h2><span className="aside">drives who stays and who leaves</span></div>
        <div className="vitals">
          <Meter label="Prosperity" frac={prosperity} text={d.prosperity >= 0 ? `+${d.prosperity.toFixed(2)}` : d.prosperity.toFixed(2)} color={tone(prosperity, 0.55, 0.35)} />
          <Meter label="Food security" frac={d.nourishment} text={`${Math.round(d.nourishment * 100)}%`} color={tone(d.nourishment, 0.55, 0.4)} />
          <Meter label="Food reserve" frac={d.reserveDays / 8} text={`${d.reserveDays.toFixed(1)} days`} color={tone(d.reserveDays / 8, 0.25, 0.08)} />
          <Meter label="Water" frac={d.water} text={`${Math.round(d.water * 100)}%`} color={tone(d.water)} />
          <Meter label="Safety" frac={d.security} text={`${Math.round(d.security * 100)}%`} color={tone(d.security)} />
          <Meter label="Room" frac={1 - Math.max(0, housingFrac - 0.6) / 0.8} text={`${Math.round(housingFrac * 100)}% full`} color={tone(1 - Math.max(0, housingFrac - 0.6) / 0.8)} />
          <Meter label="Work" frac={d.employment} text={`${Math.round(d.employment * 100)}%`} color={tone(d.employment)} />
          <Meter label="Health" frac={1 - d.disease} text={d.disease > 0 ? `${Math.round(d.disease * 100)}% sick` : 'No sickness'} color={tone(1 - d.disease * 3)} />
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Pressure to leave {Math.round(d.pressure * 100)}%{d.reserved > 0 ? ` · ${d.reserved} arrivals expected` : ''}.
        </div>
      </section>
      <section className="section">
        <div className="section-head"><h2>Economy</h2><span className="aside">per day</span></div>
        <dl className="kv">
          <dt>Food gathered</dt><dd>{d.foodProd.toFixed(1)}</dd>
          <dt>Food eaten from stores</dt><dd>{d.foodCons.toFixed(1)}</dd>
          {d.imports > 0.05 && <><dt>Food from trade</dt><dd>{d.imports.toFixed(1)}</dd></>}
          <dt>Stores</dt><dd>{fmtNum(d.stock.food)} food · {fmtNum(d.stock.wood)} wood · {fmtNum(d.stock.stone)} stone{d.stock.ore ? ` · ${d.stock.ore} ore` : ''}</dd>
          <dt>Jobs</dt><dd>{Math.round(d.jobs)} for {d.population} people</dd>
          <dt>Moved in · out</dt><dd>{d.migIn} · {d.migOut}</dd>
        </dl>
      </section>
      <section className="section">
        <div className="section-head"><h2>Buildings</h2></div>
        <dl className="kv">
          <dt>Timber and earth</dt><dd>{d.structures.wood.toFixed(1)}</dd>
          <dt>Stone</dt><dd>{d.structures.stone.toFixed(1)}</dd>
          <dt>Walls</dt><dd>{d.structures.walls ? `${Math.round(d.structures.wallCondition * 100)}% sound` : 'None'}</dd>
          <dt>Fields</dt><dd>{d.structures.farms}</dd>
        </dl>
      </section>
    </>
  );
}

function Remains({ d }: { d: SettlementDetail }) {
  return (
    <section className="section">
      <div className="section-head"><h2>What remains</h2><span className="aside">timber rots, stone endures</span></div>
      <dl className="kv">
        <dt>Peak population</dt><dd>{d.peak}</dd>
        <dt>Founded</dt><dd>{fmtDate(d.founded)}</dd>
        <dt>Timber and earth standing</dt><dd>{d.structures.wood.toFixed(1)}</dd>
        <dt>Stone standing</dt><dd>{d.structures.stone.toFixed(1)}</dd>
        <dt>Walls</dt><dd>{d.structures.walls || d.structures.wallCondition > 0 ? `${Math.round(d.structures.wallCondition * 100)}% standing` : 'None'}</dd>
        <dt>Old fields</dt><dd>{d.structures.farms ? `${d.structures.farms}, ${Math.round((1 - d.structures.farmCondition) * 100)}% overgrown` : 'None'}</dd>
        <dt>Stores left behind</dt><dd>{fmtNum(d.stock.food)} food · {fmtNum(d.stock.wood)} wood · {fmtNum(d.stock.stone)} stone</dd>
      </dl>
    </section>
  );
}

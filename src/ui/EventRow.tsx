import { CornerDownRight } from 'lucide-react';
import { useUI } from '../client/store';
import { selectCreature, selectSettlement } from './client';
import { flyTo } from './Dashboard';
import { EventIcon } from './EventIcon';
import { fmtDate } from './charts/common';
import type { SimEvent } from '../engine/types';

/** Navigate to whatever an event is about: fly there and open its creature or settlement. */
export function selectEvent(e: SimEvent): void {
  const st = useUI.getState();
  if (e.x !== undefined && e.y !== undefined) flyTo(e.x, e.y, 8);
  if (e.creatureId !== undefined) selectCreature(e.creatureId);
  else if (e.settlementId !== undefined) selectSettlement(e.settlementId);
  if (e.tribeId !== undefined) st.set({ selectedTribe: e.tribeId });
}

/** Show the event that caused this one in the Chronicle, and go there. */
export function focusCause(cause: SimEvent): void {
  useUI.getState().set({ panel: 'chronicle', panelOpen: true, focusEvent: cause.id });
  selectEvent(cause);
}

export function EventRow({ e, compact = false, focused = false }: { e: SimEvent; compact?: boolean; focused?: boolean }) {
  const cause = useUI((s) => (e.causeId !== undefined ? s.events.find((x) => x.id === e.causeId) : undefined));
  return (
    <div className={`ev lvl-${e.level}${focused ? ' focus' : ''}${compact ? ' compact' : ''}`} data-ev={e.id}>
      <button className="ev-main" onClick={() => selectEvent(e)} title={e.x !== undefined ? 'Show on map' : undefined}>
        <EventIcon cat={e.cat} />
        <span>
          <b>{e.title}</b><small>{fmtDate(e.tick)}</small>
          <p>{e.text}</p>
        </span>
      </button>
      {cause && (
        <button className="ev-cause" onClick={() => focusCause(cause)} title="Show the event that led to this">
          <CornerDownRight size={12} aria-hidden="true" />
          <span>Because of: <b>{cause.title}</b> · {fmtDate(cause.tick)}</span>
        </button>
      )}
    </div>
  );
}

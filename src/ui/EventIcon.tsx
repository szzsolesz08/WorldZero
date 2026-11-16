import { Dna, Landmark, Swords, Zap, CloudSun, Footprints, Hourglass, Sparkles, MoveRight, Castle } from 'lucide-react';
import type { EventCategory } from '../engine/types';

const ICONS: Record<EventCategory, typeof Dna> = {
  species: Dna,
  evolution: Dna,
  civ: Landmark,
  war: Swords,
  disaster: Zap,
  climate: CloudSun,
  creature: Footprints,
  milestone: Hourglass,
  god: Sparkles,
  migration: MoveRight,
  settlement: Castle,
};

export function EventIcon({ cat }: { cat: EventCategory }) {
  const I = ICONS[cat] ?? Hourglass;
  return (
    <span className={`ev-icon c-${cat}`} aria-hidden="true">
      <I size={13} strokeWidth={2} />
    </span>
  );
}

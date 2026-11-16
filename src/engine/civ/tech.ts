export interface TechDef {
  id: string;
  name: string;
  cost: number;
  requires: string[];
  /** Culture affinity weights: which cultures favour researching this. */
  affinity: { militarism?: number; openness?: number; scholarship?: number; agrarian?: number; coastal?: number; cold?: number };
  description: string;
}

export const TECHS: TechDef[] = [
  { id: 'language', name: 'Language', cost: 30, requires: [], affinity: { openness: 1, scholarship: 1 }, description: 'Members share the locations of food and water.' },
  { id: 'tools', name: 'Stone Tools', cost: 45, requires: [], affinity: { agrarian: 0.5, militarism: 0.5 }, description: 'Gathering yields +50%.' },
  { id: 'fire', name: 'Fire', cost: 60, requires: ['tools'], affinity: { cold: 2, scholarship: 0.4 }, description: 'Settlements shelter members from the cold.' },
  { id: 'hunting', name: 'Spears & Hunting', cost: 80, requires: ['tools'], affinity: { militarism: 1.5 }, description: '+35% combat, hunt larger prey.' },
  { id: 'agriculture', name: 'Agriculture', cost: 110, requires: ['tools'], affinity: { agrarian: 2 }, description: 'Farms around settlements multiply food.' },
  { id: 'pottery', name: 'Pottery', cost: 110, requires: ['agriculture'], affinity: { agrarian: 1, openness: 0.4 }, description: 'Storage doubles and spoils slower.' },
  { id: 'construction', name: 'Construction', cost: 150, requires: ['tools'], affinity: { agrarian: 0.6, scholarship: 0.4 }, description: 'Villages and faster building.' },
  { id: 'sailing', name: 'Sailing', cost: 170, requires: ['construction'], affinity: { coastal: 2.5, openness: 0.8 }, description: 'Members can cross shallow seas.' },
  { id: 'bronze', name: 'Bronze Working', cost: 210, requires: ['hunting', 'construction'], affinity: { militarism: 1.5 }, description: '+50% combat, ore becomes valuable.' },
  { id: 'writing', name: 'Writing', cost: 230, requires: ['language', 'pottery'], affinity: { scholarship: 2 }, description: 'Research +50%.' },
  { id: 'trade', name: 'Trade Routes', cost: 210, requires: ['language', 'pottery'], affinity: { openness: 2 }, description: 'Caravans travel to allies, building friendship and wealth.' },
  { id: 'masonry', name: 'Masonry', cost: 260, requires: ['construction'], affinity: { militarism: 0.8, agrarian: 0.5 }, description: 'Towns and defensive walls.' },
  { id: 'governance', name: 'Governance', cost: 320, requires: ['writing'], affinity: { scholarship: 1, openness: 0.6 }, description: 'New forms of government.' },
  { id: 'medicine', name: 'Medicine', cost: 320, requires: ['writing'], affinity: { scholarship: 1.5 }, description: 'Faster healing, resistance to plague.' },
  { id: 'engineering', name: 'Engineering', cost: 420, requires: ['masonry', 'bronze'], affinity: { scholarship: 0.8, militarism: 0.6 }, description: 'Cities become possible.' },
  { id: 'philosophy', name: 'Philosophy', cost: 450, requires: ['governance'], affinity: { scholarship: 1.5, openness: 1 }, description: 'Mature political systems.' },
];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

export function availableTechs(known: string[]): TechDef[] {
  return TECHS.filter((t) => !known.includes(t.id) && t.requires.every((r) => known.includes(r)));
}

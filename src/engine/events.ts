import type { SimEvent } from './types';

const MAX_EVENTS = 1500;

export class EventLog {
  events: SimEvent[] = [];
  nextId = 1;

  push(e: Omit<SimEvent, 'id'>): SimEvent {
    const ev = { ...e, id: this.nextId++ } as SimEvent;
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) {
      // Drop the oldest minor events first so the chronicle keeps major history.
      const idx = this.events.findIndex((x) => x.level === 1);
      this.events.splice(idx >= 0 ? idx : 0, 1);
    }
    return ev;
  }

  since(id: number): SimEvent[] {
    // Events are id-ordered; scan from the end.
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].id > id) i--;
    return this.events.slice(i);
  }

  serialize() {
    return { events: this.events.map((e) => ({ ...e })), nextId: this.nextId };
  }

  static deserialize(d: ReturnType<EventLog['serialize']>): EventLog {
    const l = new EventLog();
    l.events = d.events;
    l.nextId = d.nextId;
    return l;
  }
}

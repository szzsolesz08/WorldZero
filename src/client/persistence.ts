import type { SimState } from '../engine/simulation';
import type { ScenarioConfig } from '../engine/scenarios';
import { SAVE_VERSION, MIN_SAVE_VERSION } from '../engine/constants';

/** Saves this build can open: older versions are upgraded by the engine on load, never discarded. */
export function isReadableVersion(v: unknown): boolean {
  return typeof v === 'number' && v >= MIN_SAVE_VERSION && v <= SAVE_VERSION;
}

const DB = 'world-zero';
const STORE = 'saves';
const AUTOSAVE = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const v = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return v;
}

async function del(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

export interface SaveRecord {
  state: SimState;
  savedAt: number;
  name: string;
  population: number;
  tick: number;
}

export async function writeAutosave(state: SimState, population: number): Promise<void> {
  try {
    await put(AUTOSAVE, { state, savedAt: Date.now(), name: 'Autosave', population, tick: state.tick } satisfies SaveRecord);
  } catch (e) {
    console.warn('Autosave failed', e);
  }
}

/**
 * Returns the autosave if present and readable (older supported versions are upgraded on load).
 * A save from an unsupported version is kept untouched — it is simply not resumed — so nothing is silently destroyed.
 */
export async function readAutosave(): Promise<SaveRecord | null> {
  try {
    const r = await get<SaveRecord>(AUTOSAVE);
    if (!r || !r.state || !isReadableVersion(r.state.version)) {
      if (r?.state) console.warn(`Autosave has unsupported version ${r.state.version}; starting a new world (the old save is kept).`);
      return null;
    }
    return r;
  } catch (e) {
    console.warn('Autosave unreadable, starting fresh', e);
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try { await del(AUTOSAVE); } catch { /* ignore */ }
}

export async function writeSlot(slot: string, state: SimState, population: number, name: string): Promise<void> {
  await put(`slot:${slot}`, { state, savedAt: Date.now(), name, population, tick: state.tick } satisfies SaveRecord);
}

export async function readSlot(slot: string): Promise<SaveRecord | null> {
  try {
    const r = await get<SaveRecord>(`slot:${slot}`);
    return r && isReadableVersion(r.state?.version) ? r : null;
  } catch {
    return null;
  }
}

// ---------- File export / import (typed arrays become tagged base64) ----------

function encode(v: unknown): unknown {
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const ta = v as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number; constructor: { name: string } };
    const bytes = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { __ta: ta.constructor.name, b64: btoa(bin) };
  }
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = encode(x);
    return o;
  }
  return v;
}

const CTORS: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Float32Array, Float64Array, Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Uint8ClampedArray,
};

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.__ta === 'string' && typeof o.b64 === 'string') {
      const bin = atob(o.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const C = CTORS[o.__ta];
      return C ? new C(bytes.buffer) : bytes;
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = decode(x);
    return out;
  }
  return v;
}

export function exportStateFile(state: SimState, filename: string): void {
  const blob = new Blob([JSON.stringify(encode(state))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function importStateFile(file: File): Promise<SimState> {
  const text = await file.text();
  const state = decode(JSON.parse(text)) as SimState;
  if (!state || typeof state.version !== 'number') throw new Error('This file is not a WORLD ZERO save.');
  if (!isReadableVersion(state.version)) throw new Error(`This save is version ${state.version}; this build of WORLD ZERO opens versions ${MIN_SAVE_VERSION}–${SAVE_VERSION}.`);
  return state;
}

// ---------- Custom scenarios (small; localStorage) ----------

const CUSTOM_KEY = 'world-zero:custom-scenarios';

export function loadCustomScenarios(): ScenarioConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as ScenarioConfig[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomScenario(sc: ScenarioConfig): ScenarioConfig[] {
  const list = loadCustomScenarios().filter((s) => s.id !== sc.id);
  list.push(sc);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  return list;
}

export function deleteCustomScenario(id: string): ScenarioConfig[] {
  const list = loadCustomScenarios().filter((s) => s.id !== id);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

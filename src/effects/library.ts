import { parseEffectDefinition } from "../metadata/parse";
import type { EffectDefinitionV1 } from "../types";

export interface EffectLibraryEntryV1 {
  id: string;
  name: string;
  effect: EffectDefinitionV1;
}

export interface EffectLibraryV1 {
  version: 1;
  entries: EffectLibraryEntryV1[];
}

export const EMPTY_EFFECT_LIBRARY: EffectLibraryV1 = { version: 1, entries: [] };

export function loadEffectLibrary(storage: Pick<Storage, "getItem">, key: string): EffectLibraryV1 {
  try {
    const serialized = storage.getItem(key);
    return serialized ? parseEffectLibrary(JSON.parse(serialized)) : EMPTY_EFFECT_LIBRARY;
  } catch {
    return EMPTY_EFFECT_LIBRARY;
  }
}

export function parseEffectLibrary(value: unknown): EffectLibraryV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_EFFECT_LIBRARY;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.entries)) return EMPTY_EFFECT_LIBRARY;
  const entries: EffectLibraryEntryV1[] = [];
  for (const raw of candidate.entries) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const effect = parseEffectDefinition(entry.effect);
    if (typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || !entry.name.trim() || !effect) continue;
    entries.push({ id: entry.id, name: entry.name.trim().slice(0, 80), effect });
  }
  return { version: 1, entries };
}

export function instantiateLibraryEffect(entry: EffectLibraryEntryV1): EffectDefinitionV1 {
  return { ...structuredClone(entry.effect), id: crypto.randomUUID() };
}

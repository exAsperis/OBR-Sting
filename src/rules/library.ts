import { parseDetectionRule } from "../metadata/parse";
import type { DetectionRuleV1 } from "../types";

export interface RuleLibraryEntryV1 {
  id: string;
  name: string;
  rule: DetectionRuleV1;
}

export interface RuleLibraryV1 {
  version: 1;
  entries: RuleLibraryEntryV1[];
}

export const EMPTY_RULE_LIBRARY: RuleLibraryV1 = { version: 1, entries: [] };

export function parseRuleLibrary(value: unknown): RuleLibraryV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_RULE_LIBRARY;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.entries)) return EMPTY_RULE_LIBRARY;
  const entries: RuleLibraryEntryV1[] = [];
  for (const raw of candidate.entries) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const rule = parseDetectionRule(entry.rule);
    if (typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || !entry.name.trim() || !rule) continue;
    entries.push({ id: entry.id, name: entry.name.trim().slice(0, 80), rule });
  }
  return { version: 1, entries };
}

export function loadRuleLibrary(storage: Pick<Storage, "getItem">, key: string): RuleLibraryV1 {
  try {
    const serialized = storage.getItem(key);
    return serialized ? parseRuleLibrary(JSON.parse(serialized)) : EMPTY_RULE_LIBRARY;
  } catch {
    return EMPTY_RULE_LIBRARY;
  }
}

export function instantiateLibraryRule(entry: RuleLibraryEntryV1): DetectionRuleV1 {
  const rule = structuredClone(entry.rule);
  return { ...rule, id: crypto.randomUUID(), effects: rule.effects.map((effect) => ({ ...effect, id: crypto.randomUUID() })) };
}

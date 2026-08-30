import type { GridMeasurement, GridType, Item } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY } from "../constants";
import { parseEmitterMetadata } from "../metadata/parse";
import { isSameAttachmentFamily } from "../scene/attachments";
import type { AttachmentGraph, DetectionRuleV1, RuleEvaluation, RuleEvaluationSet } from "../types";
import { getSceneDistance } from "./distance";
import { calculateStrength } from "./strength";
import type { DistanceMethod } from "../settings";
import { parseEmitterSignal } from "../signals/normalize";

export interface IndexedEmitter { item: Item; range?: number }

export function indexEmittersBySignal(items: Item[]): Map<string, IndexedEmitter[]> {
  const grouped = new Map<string, Map<string, IndexedEmitter>>();
  for (const item of items) {
    const metadata = parseEmitterMetadata(item.metadata[EMITTER_KEY]);
    if (!metadata?.enabled) continue;
    for (const tag of metadata?.signals ?? []) {
      const parsed = parseEmitterSignal(tag);
      if (!parsed) continue;
      const emitters = grouped.get(parsed.signal) ?? new Map<string, IndexedEmitter>();
      const existing = emitters.get(item.id);
      if (!existing || existing.range !== undefined && (parsed.range === undefined || parsed.range > existing.range)) {
        emitters.set(item.id, { item, ...(parsed.range !== undefined ? { range: parsed.range } : {}) });
      }
      grouped.set(parsed.signal, emitters);
    }
  }
  return new Map([...grouped].map(([signal, emitters]) => [signal, [...emitters.values()]]));
}

export function selectRuleEvaluations(rule: DetectionRuleV1, candidates: RuleEvaluation[]): RuleEvaluation[] {
  const ordered = [...candidates].sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));
  return rule.aggregation === "all"
    ? ordered.filter((candidate) => candidate.strength > 0)
    : ordered.slice(0, 1);
}

export async function evaluateRule(
  detector: Item,
  rule: DetectionRuleV1,
  signalIndex: Map<string, IndexedEmitter[]>,
  graph: AttachmentGraph,
  scaleMultiplier: number,
  grid: { dpi: number; type: GridType; measurement: GridMeasurement },
  distanceMethod: DistanceMethod,
): Promise<RuleEvaluationSet> {
  const matches = (signalIndex.get(rule.signal) ?? []).filter(({ item }) =>
    !isSameAttachmentFamily(detector, item, graph) && (!rule.ignoreHidden || item.visible)
  );
  const inRange = (await Promise.all(matches.map(async ({ item: emitter, range }) => ({
    emitter,
    range,
    distance: await getSceneDistance(detector.position, emitter.position, scaleMultiplier, grid, distanceMethod),
  })))).filter(({ distance, range }) => range === undefined || distance <= range);
  const candidates: RuleEvaluation[] = inRange.map(({ emitter, distance }) => ({
      detector,
      rule,
      matchingEmitterCount: inRange.length,
      detectedEmitter: emitter,
      distance,
      strength: calculateStrength(distance, rule.range.outer, rule.range.inner, rule.falloff),
    }));
  const selected = selectRuleEvaluations(rule, candidates);
  if (rule.aggregation === "all") return { matchingEmitterCount: inRange.length, evaluations: selected };
  return {
    matchingEmitterCount: inRange.length,
    evaluations: [selected[0] ?? {
      detector,
      rule,
      matchingEmitterCount: 0,
      detectedEmitter: null,
      distance: null,
      strength: 0,
    }],
  };
}

import type { Item } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY } from "../constants";
import { parseEmitterMetadata } from "../metadata/parse";
import { isSameAttachmentFamily } from "../scene/attachments";
import type { AttachmentGraph, DetectionRuleV1, RuleEvaluation, RuleEvaluationSet } from "../types";
import { getSceneDistance } from "./distance";
import { calculateStrength } from "./strength";
import type { DistanceMethod } from "../settings";

export function indexEmittersBySignal(items: Item[]): Map<string, Item[]> {
  const index = new Map<string, Item[]>();
  for (const item of items) {
    const metadata = parseEmitterMetadata(item.metadata[EMITTER_KEY]);
    for (const signal of metadata?.signals ?? []) index.set(signal, [...(index.get(signal) ?? []), item]);
  }
  return index;
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
  signalIndex: Map<string, Item[]>,
  graph: AttachmentGraph,
  scaleMultiplier: number,
  dpi: number,
  distanceMethod: DistanceMethod,
): Promise<RuleEvaluationSet> {
  const matches = (signalIndex.get(rule.signal) ?? []).filter((item) =>
    !isSameAttachmentFamily(detector, item, graph) && (!rule.ignoreHidden || item.visible)
  );
  const candidates: RuleEvaluation[] = [];
  for (const emitter of matches) {
    const distance = await getSceneDistance(detector.position, emitter.position, scaleMultiplier, dpi, distanceMethod);
    candidates.push({
      detector,
      rule,
      matchingEmitterCount: matches.length,
      detectedEmitter: emitter,
      distance,
      strength: calculateStrength(distance, rule.range.outer, rule.range.inner, rule.falloff),
    });
  }
  const selected = selectRuleEvaluations(rule, candidates);
  if (rule.aggregation === "all") return { matchingEmitterCount: matches.length, evaluations: selected };
  return {
    matchingEmitterCount: matches.length,
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

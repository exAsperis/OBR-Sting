import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY } from "../constants";
import { parseEmitterMetadata } from "../metadata/parse";
import { isSameAttachmentFamily } from "../scene/attachments";
import type { AttachmentGraph, DetectionRuleV1, RuleEvaluation } from "../types";
import { calculateStrength } from "./strength";

export function indexEmittersBySignal(items: Item[]): Map<string, Item[]> {
  const index = new Map<string, Item[]>();
  for (const item of items) {
    const metadata = parseEmitterMetadata(item.metadata[EMITTER_KEY]);
    for (const signal of metadata?.signals ?? []) index.set(signal, [...(index.get(signal) ?? []), item]);
  }
  return index;
}

export async function evaluateRule(
  detector: Item,
  rule: DetectionRuleV1,
  signalIndex: Map<string, Item[]>,
  graph: AttachmentGraph,
): Promise<RuleEvaluation> {
  const matches = (signalIndex.get(rule.signal) ?? []).filter((item) => !isSameAttachmentFamily(detector, item, graph));
  let nearest: Item | null = null;
  let distance: number | null = null;
  for (const emitter of matches) {
    const candidate = await OBR.scene.grid.getDistance(detector.position, emitter.position);
    if (distance === null || candidate < distance) {
      distance = candidate;
      nearest = emitter;
    }
  }
  return {
    detector,
    rule,
    matchingEmitterCount: matches.length,
    detectedEmitter: nearest,
    distance,
    strength: distance === null ? 0 : calculateStrength(distance, rule.range.outer, rule.range.inner, rule.falloff),
  };
}

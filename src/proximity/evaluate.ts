import type { GridMeasurement, GridType, Item, Light } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY, LOCAL_LIGHT_KEY } from "../constants";
import { parseEmitterMetadata } from "../metadata/parse";
import { isSameAttachmentFamily } from "../scene/attachments";
import type { AttachmentGraph, DetectionRuleV1, RuleEvaluation, RuleEvaluationSet } from "../types";
import { getSceneDistance, worldToSceneUnits } from "./distance";
import { calculateStrength } from "./strength";
import type { DistanceMethod } from "../settings";
import { parseEmitterSignal } from "../signals/normalize";

export interface IndexedEmitter { item: Item; range?: number }
export interface EvaluationSources { signals: Map<string, IndexedEmitter[]>; lights: Light[] }

/** Geometric light-area test only; walls and Dynamic Fog illumination are intentionally out of scope. */
export function isWithinLightArea(point: { x: number; y: number }, light: Light): boolean {
  const dx = point.x - light.position.x, dy = point.y - light.position.y;
  if (Math.hypot(dx, dy) > light.attenuationRadius) return false;
  if (light.outerAngle >= 360) return true;
  const bearing = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  const delta = ((bearing - light.rotation + 540) % 360) - 180;
  return Math.abs(delta) <= Math.max(0, light.outerAngle) / 2;
}

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
  sourcesOrSignalIndex: EvaluationSources | Map<string, IndexedEmitter[]>,
  graph: AttachmentGraph,
  scaleMultiplier: number,
  grid: { dpi: number; type: GridType; measurement: GridMeasurement },
  distanceMethod: DistanceMethod,
): Promise<RuleEvaluationSet> {
  const sources: EvaluationSources = sourcesOrSignalIndex instanceof Map ? { signals: sourcesOrSignalIndex, lights: [] } : sourcesOrSignalIndex;
  if (rule.source?.type === "obr-light") {
    const filter = rule.source;
    const lights = sources.lights.filter((light) =>
      (!filter.lightType || light.lightType === filter.lightType) &&
      (!filter.ownership || filter.ownership === "any" || (filter.ownership === "sting") === (light.metadata[LOCAL_LIGHT_KEY] !== undefined)) &&
      (!filter.attachment || filter.attachment === "any" || (filter.attachment === "attached") === Boolean(light.attachedTo))
    );
    const candidates = (await Promise.all(lights.map(async (light) => {
      const distance = await getSceneDistance(detector.position, light.position, scaleMultiplier, grid, distanceMethod);
      const inside = filter.detection === "distance" || isWithinLightArea(detector.position, light);
      const outer = filter.detection === "within-radius" ? worldToSceneUnits(light.attenuationRadius, grid.dpi, scaleMultiplier) : rule.range.outer;
      return { detector, rule, matchingEmitterCount: lights.length, detectedEmitter: light as Item, distance, strength: inside ? calculateStrength(distance, outer, filter.detection === "within-radius" ? 0 : rule.range.inner, rule.falloff) : 0 } satisfies RuleEvaluation;
    }))).filter((candidate) => candidate.strength > 0);
    const selected = selectRuleEvaluations(rule, candidates);
    return { matchingEmitterCount: lights.length, evaluations: rule.aggregation === "all" ? selected : [selected[0] ?? { detector, rule, matchingEmitterCount: lights.length, detectedEmitter: null, distance: null, strength: 0 }] };
  }
  const matches = (sources.signals.get(rule.signal) ?? []).filter(({ item }) =>
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

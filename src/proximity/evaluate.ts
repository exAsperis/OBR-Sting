import type { GridMeasurement, GridType, Item, Light } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY, LOCAL_LIGHT_KEY } from "../constants";
import { parseEmitterMetadata } from "../metadata/parse";
import { isSameAttachmentFamily } from "../scene/attachments";
import type { AttachmentGraph, DetectionRuleV1, RuleEvaluation, RuleEvaluationSet } from "../types";
import { getSceneDistance } from "./distance";
import { calculateStrength } from "./strength";
import type { DistanceMethod } from "../settings";
import { parseEmitterSignal } from "../signals/normalize";
import { itemLabelText } from "../scene/itemText";

export interface IndexedEmitter { item: Item; range?: number }
interface ItemBounds { min: { x: number; y: number }; max: { x: number; y: number } }
export interface EvaluationSources { signals: Map<string, IndexedEmitter[]>; lights: Light[]; items?: Item[]; getItemBounds?: (item: Item) => Promise<ItemBounds> }

export function isPointWithinBounds(point: { x: number; y: number }, bounds: ItemBounds): boolean {
  return point.x >= bounds.min.x && point.x <= bounds.max.x && point.y >= bounds.min.y && point.y <= bounds.max.y;
}

async function detectorIsWithinItemBounds(detector: Item, item: Item, sources: EvaluationSources): Promise<boolean> {
  if (!sources.getItemBounds) return false;
  try { return isPointWithinBounds(detector.position, await sources.getItemBounds(item)); }
  catch { return false; }
}

export function matchesRuleText(value: string, pattern: string, matchType: DetectionRuleV1["matchType"]): boolean {
  if (matchType === "exact") return value.trim().toLowerCase() === pattern.trim().toLowerCase();
  if (matchType === "wildcard") {
    const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    try { return new RegExp(`^${escaped}$`, "i").test(value.trim()); } catch { return false; }
  }
  try { return new RegExp(pattern, "i").test(value); } catch { return false; }
}

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Geometric approximation only; walls and rendered Dynamic Fog shadows are intentionally out of scope. */
export function lightAreaStrength(point: { x: number; y: number }, light: Light): number {
  const dx = point.x - light.position.x, dy = point.y - light.position.y;
  const radius = Math.max(0, light.attenuationRadius);
  const radialDistance = Math.hypot(dx, dy);
  if (radialDistance > radius || radius === 0 && radialDistance > 0) return 0;
  const normalizedDistance = radius > 0 ? radialDistance / radius : 0;
  const falloff = Math.max(0, light.falloff);
  const radialStrength = falloff === 0 ? 1 : 1 - smoothstep(1 - falloff, 1, normalizedDistance);
  if (light.outerAngle >= 360 || radialDistance === 0) return radialStrength;
  const bearing = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  const delta = ((bearing - light.rotation + 540) % 360) - 180;
  const outerHalfAngle = Math.max(0, light.outerAngle) / 2;
  const innerHalfAngle = Math.min(outerHalfAngle, Math.max(0, light.innerAngle) / 2);
  const angle = Math.abs(delta);
  if (angle > outerHalfAngle) return 0;
  const angularStrength = innerHalfAngle === outerHalfAngle ? 1 : 1 - smoothstep(innerHalfAngle, outerHalfAngle, angle);
  return radialStrength * angularStrength;
}

export function isWithinLightArea(point: { x: number; y: number }, light: Light): boolean {
  const dx = point.x - light.position.x, dy = point.y - light.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance > Math.max(0, light.attenuationRadius)) return false;
  if (light.outerAngle >= 360 || distance === 0) return true;
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
  const ordered = candidates.filter((candidate) => candidate.strength > 0).sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));
  return rule.aggregation === "all"
    ? ordered
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
  if (rule.disableWhenHidden && !detector.visible) {
    return rule.aggregation === "all"
      ? { matchingEmitterCount: 0, evaluations: [] }
      : { matchingEmitterCount: 0, evaluations: [{ detector, rule, matchingEmitterCount: 0, detectedEmitter: null, distance: null, strength: 0 }] };
  }
  if (rule.source?.type === "obr-light") {
    const filter = rule.source;
    const lights = sources.lights.filter((light) =>
      !rule.excludeLayers.includes(light.layer) &&
      (!filter.lightType || light.lightType === filter.lightType) &&
      (!filter.ownership || filter.ownership === "any" || (filter.ownership === "sting") === (light.metadata[LOCAL_LIGHT_KEY] !== undefined)) &&
      (!filter.attachment || filter.attachment === "any" || (filter.attachment === "attached") === Boolean(light.attachedTo))
    );
    const candidates = (await Promise.all(lights.map(async (light) => {
      const distance = await getSceneDistance(detector.position, light.position, scaleMultiplier, grid, distanceMethod);
      const strength = rule.detectionArea === "source-area"
        ? lightAreaStrength(detector.position, light)
        : calculateStrength(distance, rule.range.outer, rule.range.inner, rule.falloff);
      return { detector, rule, matchingEmitterCount: lights.length, detectedEmitter: light as Item, distance, strength } satisfies RuleEvaluation;
    }))).filter((candidate) => candidate.strength > 0);
    const selected = selectRuleEvaluations(rule, candidates);
    return { matchingEmitterCount: lights.length, evaluations: rule.aggregation === "all" ? selected : [selected[0] ?? { detector, rule, matchingEmitterCount: lights.length, detectedEmitter: null, distance: null, strength: 0 }] };
  }
  const matchingSignals = [...sources.signals].filter(([signal]) => matchesRuleText(signal, rule.signal, rule.matchType)).flatMap(([, emitters]) => emitters);
  const deduplicatedSignals = [...matchingSignals.reduce((items, emitter) => {
    const current = items.get(emitter.item.id);
    if (!current || current.range !== undefined && (emitter.range === undefined || emitter.range > current.range)) items.set(emitter.item.id, emitter);
    return items;
  }, new Map<string, IndexedEmitter>()).values()];
  const sourceMatches: IndexedEmitter[] = rule.source?.type === "item-name"
    ? (sources.items ?? []).filter((item) => matchesRuleText(item.name, rule.signal, rule.matchType)).map((item) => ({ item }))
    : rule.source?.type === "item-label"
      ? (sources.items ?? []).filter((item) => matchesRuleText(itemLabelText(item), rule.signal, rule.matchType)).map((item) => ({ item }))
      : deduplicatedSignals;
  const matches = sourceMatches.filter(({ item }) =>
    !rule.excludeLayers.includes(item.layer) && !isSameAttachmentFamily(detector, item, graph) && (!rule.ignoreHidden || item.visible)
  );
  const inRange = (await Promise.all(matches.map(async ({ item: emitter, range }) => ({
    emitter,
    range,
    distance: await getSceneDistance(detector.position, emitter.position, scaleMultiplier, grid, distanceMethod),
  })))).filter(({ distance, range }) => rule.detectionArea === "source-area" || range === undefined || distance <= range);
  const candidates: RuleEvaluation[] = await Promise.all(inRange.map(async ({ emitter, distance }) => ({
      detector,
      rule,
      matchingEmitterCount: inRange.length,
      detectedEmitter: emitter,
      distance,
      strength: rule.detectionArea === "source-area"
        ? await detectorIsWithinItemBounds(detector, emitter, sources) ? 1 : 0
        : calculateStrength(distance, rule.range.outer, rule.range.inner, rule.falloff),
    })));
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

import { normalizeSignal, normalizeSignals } from "../signals/normalize";
import type {
  DetectionRuleV1,
  DetectorMetadataV1,
  EffectAudienceV1,
  EffectDefinitionV1,
  EffectTargetV1,
  EmitterMetadataV1,
  ShaderPreset,
} from "../types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const color = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function parseEmitterMetadata(value: unknown): EmitterMetadataV1 | null {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.signals)) return null;
  const signals = normalizeSignals(value.signals.filter((entry): entry is string => typeof entry === "string"));
  return { version: 1, signals };
}

function parseTarget(value: unknown): EffectTargetV1 | null {
  if (!record(value)) return null;
  if (["detector", "parent", "carrier", "detected-emitter"].includes(String(value.type))) {
    return { type: value.type as "detector" | "parent" | "carrier" | "detected-emitter" };
  }
  return value.type === "specific-item" && id(value.itemId)
    ? { type: "specific-item", itemId: value.itemId }
    : null;
}

function parseAudience(value: unknown): EffectAudienceV1 | null {
  if (!record(value)) return null;
  if (["everyone", "gm", "players", "detector-owner", "carrier-owner", "target-owner"].includes(String(value.type))) {
    return { type: value.type as Exclude<EffectAudienceV1["type"], "specific-users"> } as EffectAudienceV1;
  }
  return value.type === "specific-users" && Array.isArray(value.userIds)
    ? { type: "specific-users", userIds: [...new Set(value.userIds.filter(id))] }
    : null;
}

export function parseEffectDefinition(value: unknown): EffectDefinitionV1 | null {
  if (!record(value) || value.type !== "shader" || !id(value.id) || typeof value.enabled !== "boolean") return null;
  const target = parseTarget(value.target);
  const audience = parseAudience(value.audience);
  const presets: ShaderPreset[] = ["glow", "pulse", "flicker", "outline"];
  if (!target || !audience || !presets.includes(value.preset as ShaderPreset) || !color(value.color)) return null;
  if (!finite(value.maxIntensity) || value.maxIntensity < 0 || value.maxIntensity > 2) return null;
  if (!finite(value.spread) || value.spread <= 0 || value.spread > 4) return null;
  let animation: { rate: number; depth: number } | undefined;
  if (value.animation !== undefined) {
    if (!record(value.animation) || !finite(value.animation.rate) || !finite(value.animation.depth)) return null;
    if (value.animation.rate < 0 || value.animation.rate > 10 || value.animation.depth < 0 || value.animation.depth > 1) return null;
    animation = { rate: value.animation.rate, depth: value.animation.depth };
  }
  return {
    id: value.id,
    type: "shader",
    enabled: value.enabled,
    target,
    audience,
    preset: value.preset as ShaderPreset,
    color: value.color.toLowerCase(),
    maxIntensity: value.maxIntensity,
    spread: value.spread,
    ...(animation ? { animation } : {}),
  };
}

export function parseDetectionRule(value: unknown): DetectionRuleV1 | null {
  if (!record(value) || !id(value.id) || typeof value.enabled !== "boolean") return null;
  const signal = typeof value.signal === "string" ? normalizeSignal(value.signal) : "";
  if (!signal || value.aggregation !== "nearest" || !["binary", "linear", "smoothstep"].includes(String(value.falloff))) return null;
  if (!record(value.range) || !finite(value.range.outer) || !finite(value.range.inner)) return null;
  if (value.range.outer <= 0 || value.range.inner < 0 || value.range.inner >= value.range.outer) return null;
  if (!Array.isArray(value.effects)) return null;
  const effects: EffectDefinitionV1[] = [];
  for (const candidate of value.effects) {
    const effect = parseEffectDefinition(candidate);
    if (!effect) return null;
    effects.push(effect);
  }
  if (new Set(effects.map((effect) => effect.id)).size !== effects.length) return null;
  return {
    id: value.id,
    enabled: value.enabled,
    signal,
    range: { outer: value.range.outer, inner: value.range.inner },
    aggregation: "nearest",
    falloff: value.falloff as DetectionRuleV1["falloff"],
    effects,
  };
}

export function parseDetectorMetadata(value: unknown): DetectorMetadataV1 | null {
  if (!record(value) || value.version !== 1 || typeof value.enabled !== "boolean" || !Array.isArray(value.rules)) return null;
  const rules: DetectionRuleV1[] = [];
  for (const candidate of value.rules) {
    const rule = parseDetectionRule(candidate);
    if (!rule) return null;
    rules.push(rule);
  }
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) return null;
  return { version: 1, enabled: value.enabled, rules };
}

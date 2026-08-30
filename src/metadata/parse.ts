import { normalizeSignal, normalizeSignals } from "../signals/normalize";
import type {
  DetectionRuleV1,
  DetectorMetadataV1,
  EffectAudienceV1,
  EffectDefinitionV1,
  EffectTargetV1,
  EmitterMetadataV1,
  IntegrationEffectDefinitionV1,
  JsonObject,
  MechanicalEffectDefinitionV1,
  ShaderAnimationMode,
  ShaderEffectDefinitionV1,
  ShaderPreset,
} from "../types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const color = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const jsonObject = (value: unknown): value is JsonObject => {
  try { return record(value) && JSON.stringify(value) !== undefined; } catch { return false; }
};

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
  if (!record(value) || !id(value.id) || typeof value.enabled !== "boolean") return null;
  const target = parseTarget(value.target);
  if (!target) return null;
  if (value.type === "mechanical") {
    if (value.action === "face") {
      if (!finite(value.faceAngle) || !finite(value.speed)) return null;
      if (value.faceAngle < 0 || value.faceAngle > 359 || value.speed < 15 || value.speed > 720) return null;
      return {
        id: value.id,
        type: "mechanical",
        enabled: value.enabled,
        action: "face",
        target,
        faceAngle: value.faceAngle,
        speed: value.speed,
      } satisfies MechanicalEffectDefinitionV1;
    }
    if (value.action === "visibility") {
      if (!["hidden", "shown"].includes(String(value.visibility)) || typeof value.reverseOnExit !== "boolean") return null;
      return {
        id: value.id,
        type: "mechanical",
        enabled: value.enabled,
        action: "visibility",
        target,
        visibility: value.visibility as "hidden" | "shown",
        reverseOnExit: value.reverseOnExit,
      } satisfies MechanicalEffectDefinitionV1;
    }
    return null;
  }
  const audience = parseAudience(value.audience);
  if (!audience) return null;
  // Compatibility migration for detector metadata written before the generic provider model.
  if (value.type === "emanation") {
    if (!id(value.presetName) || typeof value.removeAllOnDeactivate !== "boolean") return null;
    return {
      id: value.id,
      type: "integration",
      enabled: value.enabled,
      lifecycle: "continuous",
      target,
      audience,
      providerId: "auras-emanations",
      providerSchemaVersion: 1,
      actionId: "preset-aura",
      parameters: {
        presetName: value.presetName.trim(),
        cleanup: value.removeAllOnDeactivate ? "remove-all-with-warning" : "leave",
      },
    } satisfies IntegrationEffectDefinitionV1;
  }
  if (value.type === "integration") {
    if (!id(value.providerId) || !id(value.actionId) || !finite(value.providerSchemaVersion) || value.providerSchemaVersion < 1) return null;
    if (!["continuous", "enter", "exit", "nearest-change"].includes(String(value.lifecycle)) || !jsonObject(value.parameters)) return null;
    return {
      id: value.id,
      type: "integration",
      enabled: value.enabled,
      lifecycle: value.lifecycle as IntegrationEffectDefinitionV1["lifecycle"],
      target,
      audience,
      providerId: value.providerId.trim(),
      providerSchemaVersion: value.providerSchemaVersion,
      actionId: value.actionId.trim(),
      parameters: value.parameters,
    };
  }
  if (value.type !== "shader") return null;
  const legacyPreset = ["outline", "pulse", "flicker"].includes(String(value.preset)) ? String(value.preset) : null;
  const presets: ShaderPreset[] = ["glow", "beam"];
  if ((!legacyPreset && !presets.includes(value.preset as ShaderPreset)) || !color(value.color)) return null;
  if (!finite(value.maxIntensity) || value.maxIntensity < 0 || value.maxIntensity > 2) return null;
  if (!finite(value.spread) || value.spread <= 0 || value.spread > 4) return null;
  let geometry: ShaderEffectDefinitionV1["geometry"];
  if (value.geometry !== undefined) {
    if (!record(value.geometry)) return null;
    const { offsetX, offsetY, innerRadius, outerRadius } = value.geometry;
    if (!finite(offsetX) || !finite(offsetY) || !finite(innerRadius) || !finite(outerRadius)) return null;
    if (offsetX < -100 || offsetX > 100 || offsetY < -100 || offsetY > 100) return null;
    if (innerRadius < 0 || outerRadius <= innerRadius || outerRadius > 200) return null;
    const width = value.geometry.width ?? 100;
    const height = value.geometry.height ?? 100;
    const rotation = value.geometry.rotation ?? 0;
    if (!finite(width) || !finite(height) || !finite(rotation)) return null;
    if (width < 5 || width > 400 || height < 5 || height > 400 || rotation < -180 || rotation > 180) return null;
    geometry = { offsetX, offsetY, innerRadius, outerRadius, width, height, rotation };
  }
  let animation: ShaderEffectDefinitionV1["animation"];
  if (value.animation !== undefined) {
    if (!record(value.animation) || !finite(value.animation.rate) || !finite(value.animation.depth)) return null;
    if (value.animation.rate < 0 || value.animation.rate > 10 || value.animation.depth < 0 || value.animation.depth > 1) return null;
    const inferredMode = legacyPreset === "pulse" || legacyPreset === "flicker" ? legacyPreset : "none";
    const modes: ShaderAnimationMode[] = ["none", "pulse", "flicker", "radial-pulse"];
    if (value.animation.mode !== undefined && !modes.includes(value.animation.mode as ShaderAnimationMode)) return null;
    if (value.animation.radialDirection !== undefined && !["outward", "inward"].includes(String(value.animation.radialDirection))) return null;
    if (value.animation.waveWidth !== undefined && (!finite(value.animation.waveWidth) || value.animation.waveWidth < 0.05 || value.animation.waveWidth > 1)) return null;
    animation = {
      mode: value.animation.mode as ShaderAnimationMode ?? inferredMode,
      rate: value.animation.rate,
      depth: value.animation.depth,
      ...(value.animation.radialDirection !== undefined ? { radialDirection: value.animation.radialDirection as "outward" | "inward" } : {}),
      ...(value.animation.waveWidth !== undefined ? { waveWidth: value.animation.waveWidth } : {}),
    };
  } else if (legacyPreset === "pulse" || legacyPreset === "flicker") {
    animation = { mode: legacyPreset, rate: 1, depth: 0.35 };
  }
  let beamWidth: number | undefined;
  if (value.beamWidth !== undefined) {
    if (!finite(value.beamWidth) || value.beamWidth < 5 || value.beamWidth > 120) return null;
    beamWidth = value.beamWidth;
  }
  return {
    id: value.id,
    type: "shader",
    enabled: value.enabled,
    target,
    audience,
    preset: legacyPreset ? "glow" : value.preset as ShaderPreset,
    color: value.color.toLowerCase(),
    // Preserve the old outline's approximate opacity and feather width while
    // migrating it to the unified glow shader.
    maxIntensity: legacyPreset === "outline"
      ? Math.min(2, value.maxIntensity * (0.95 / 0.62))
      : legacyPreset === "pulse" || legacyPreset === "flicker"
        ? Math.min(2, value.maxIntensity * (0.72 / 0.62))
        : value.maxIntensity,
    spread: legacyPreset === "outline" ? Math.max(0.05, value.spread * 0.12) : value.spread,
    ...(geometry ? { geometry } : {}),
    ...(beamWidth !== undefined ? { beamWidth } : {}),
    ...(animation ? { animation } : {}),
  };
}

export function parseDetectionRule(value: unknown): DetectionRuleV1 | null {
  if (!record(value) || !id(value.id) || typeof value.enabled !== "boolean") return null;
  const signal = typeof value.signal === "string" ? normalizeSignal(value.signal) : "";
  if (!signal || !["nearest", "all"].includes(String(value.aggregation)) || !["binary", "linear", "smoothstep"].includes(String(value.falloff))) return null;
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
    aggregation: value.aggregation as DetectionRuleV1["aggregation"],
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

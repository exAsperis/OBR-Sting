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
  LightDynamicValueV1,
  LightEffectDefinitionV1,
  MechanicalEffectDefinitionV1,
  ShaderAnimationMode,
  ShaderDynamicField,
  DynamicValueRange,
  ShaderEffectDefinitionV1,
  ShaderPreset,
  ShaderPlacement,
  ShaderShape,
} from "../types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const color = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const parseImageAsset = (value: unknown): Extract<MechanicalEffectDefinitionV1, { action: "set-image" }>["asset"] | null => {
  if (!record(value) || typeof value.name !== "string" || !value.name.trim() || !record(value.image) || !record(value.grid) || !record(value.grid.offset)) return null;
  const image = value.image;
  const grid = value.grid;
  const offset = grid.offset as Record<string, unknown>;
  if (!finite(image.width) || image.width <= 0 || !finite(image.height) || image.height <= 0 || typeof image.mime !== "string" || !image.mime || typeof image.url !== "string" || !image.url) return null;
  if (!finite(grid.dpi) || grid.dpi <= 0 || !finite(offset.x) || !finite(offset.y)) return null;
  return { name: value.name.trim(), image: { width: image.width, height: image.height, mime: image.mime, url: image.url }, grid: { dpi: grid.dpi, offset: { x: offset.x, y: offset.y } } };
};
const jsonObject = (value: unknown): value is JsonObject => {
  try { return record(value) && JSON.stringify(value) !== undefined; } catch { return false; }
};
const parseLightValue = (value: unknown, minimum: number, maximum: number): LightDynamicValueV1 | null => {
  if (!record(value) || !finite(value.value) || value.value < minimum || value.value > maximum) return null;
  if (value.range === undefined) return { value: value.value };
  if (!record(value.range) || !finite(value.range.minimum) || !finite(value.range.maximum) || value.range.minimum < minimum || value.range.minimum > maximum || value.range.maximum < minimum || value.range.maximum > maximum) return null;
  if (value.range.enabled !== undefined && typeof value.range.enabled !== "boolean") return null;
  return { value: value.value, range: { minimum: value.range.minimum, maximum: value.range.maximum, ...(value.range.enabled === false ? { enabled: false } : {}) } };
};

export function parseEmitterMetadata(value: unknown): EmitterMetadataV1 | null {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.signals)) return null;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return null;
  const signals = normalizeSignals(value.signals.filter((entry): entry is string => typeof entry === "string"));
  return { version: 1, enabled: value.enabled ?? true, signals };
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
  if (value.name !== undefined && (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 80)) return null;
  const named = value.name !== undefined ? { name: (value.name as string).trim() } : {};
  const target = parseTarget(value.target);
  if (!target) return null;
  if (value.type === "mechanical") {
    if (value.action === "face") {
      if (!finite(value.faceAngle) || !finite(value.speed)) return null;
      if (value.faceAngle < 0 || value.faceAngle > 359 || value.speed < 15 || value.speed > 720) return null;
      const pivotX = value.pivotX ?? 0;
      const pivotY = value.pivotY ?? 0;
      if (!finite(pivotX) || !finite(pivotY) || pivotX < -500 || pivotX > 500 || pivotY < -500 || pivotY > 500) return null;
      if (value.reverseOnExit !== undefined && typeof value.reverseOnExit !== "boolean") return null;
      return {
        id: value.id,
        ...named,
        type: "mechanical",
        enabled: value.enabled,
        action: "face",
        target,
        faceAngle: value.faceAngle,
        pivotX,
        pivotY,
        speed: value.speed,
        reverseOnExit: value.reverseOnExit ?? false,
      } satisfies MechanicalEffectDefinitionV1;
    }
    if (value.action === "visibility") {
      if (!["hidden", "shown", "toggle"].includes(String(value.visibility)) || typeof value.reverseOnExit !== "boolean") return null;
      return {
        id: value.id,
        ...named,
        type: "mechanical",
        enabled: value.enabled,
        action: "visibility",
        target,
        visibility: value.visibility as "hidden" | "shown" | "toggle",
        reverseOnExit: value.reverseOnExit,
      } satisfies MechanicalEffectDefinitionV1;
    }
    if (value.action === "lock") {
      if (typeof value.locked !== "boolean" || value.toggle !== undefined && typeof value.toggle !== "boolean" || typeof value.reverseOnExit !== "boolean") return null;
      return { id: value.id, ...named, type: "mechanical", enabled: value.enabled, action: "lock", target, locked: value.locked, ...(value.toggle === true ? { toggle: true } : {}), reverseOnExit: value.reverseOnExit } satisfies MechanicalEffectDefinitionV1;
    }
    if (value.action === "set-image") {
      if (value.asset !== undefined && !parseImageAsset(value.asset)) return null;
      if (typeof value.constrainToOriginalSize !== "boolean" || typeof value.reverseOnExit !== "boolean") return null;
      return { id: value.id, ...named, type: "mechanical", enabled: value.enabled, action: "set-image", target, ...(value.asset === undefined ? {} : { asset: parseImageAsset(value.asset)! }), constrainToOriginalSize: value.constrainToOriginalSize, reverseOnExit: value.reverseOnExit } satisfies MechanicalEffectDefinitionV1;
    }
    if (value.action === "emitter") {
      if (!["add", "remove", "toggle"].includes(String(value.operation)) || typeof value.signal !== "string" || typeof value.reverseOnExit !== "boolean") return null;
      return { id: value.id, ...named, type: "mechanical", enabled: value.enabled, action: "emitter", target, operation: value.operation as "add" | "remove" | "toggle", signal: value.signal, reverseOnExit: value.reverseOnExit } satisfies MechanicalEffectDefinitionV1;
    }
    return null;
  }
  const audience = parseAudience(value.audience);
  if (!audience) return null;
  if (value.type === "light") {
    if (!["add", "modify", "spotlight"].includes(String(value.action))) return null;
    if (value.duration !== undefined && !["temporary", "permanent"].includes(String(value.duration))) return null;
    const attenuationRadius = parseLightValue(value.attenuationRadius, 0, value.radiusOperation === "multiply" ? 20 : 1000);
    const sourceRadius = value.sourceRadius === undefined ? undefined : parseLightValue(value.sourceRadius, 0, 1000);
    const falloff = value.falloff === undefined ? undefined : parseLightValue(value.falloff, 0, 10);
    const innerAngle = value.innerAngle === undefined ? undefined : parseLightValue(value.innerAngle, 0, 360);
    const outerAngle = value.outerAngle === undefined ? undefined : parseLightValue(value.outerAngle, 0, 360);
    if (!attenuationRadius || value.sourceRadius !== undefined && !sourceRadius || value.falloff !== undefined && !falloff || value.innerAngle !== undefined && !innerAngle || value.outerAngle !== undefined && !outerAngle) return null;
    if (value.lightType !== undefined && !["PRIMARY", "SECONDARY", "AUXILIARY"].includes(String(value.lightType))) return null;
    if (value.radiusOperation !== undefined && !["set", "add", "multiply"].includes(String(value.radiusOperation))) return null;
    if (value.rotationBehavior !== undefined && !["target", "fixed"].includes(String(value.rotationBehavior))) return null;
    if (value.rotation !== undefined && (!finite(value.rotation) || value.rotation < -360 || value.rotation > 360)) return null;
    const spotlightAngle = value.spotlightAngle ?? 0;
    const spotlightSpeed = value.spotlightSpeed ?? 180;
    if (!finite(spotlightAngle) || spotlightAngle < 0 || spotlightAngle > 359 || !finite(spotlightSpeed) || spotlightSpeed < 15 || spotlightSpeed > 720) return null;
    // Spotlight already aims at the detected emitter, so using it as the light target is self-referential.
    const lightTarget = value.action === "spotlight" && target.type === "detected-emitter" ? { type: "detector" as const } : target;
    return { id: value.id, ...named, type: "light", enabled: value.enabled, action: value.action as LightEffectDefinitionV1["action"], duration: value.duration as LightEffectDefinitionV1["duration"] ?? "temporary", target: lightTarget, audience, attenuationRadius, ...(sourceRadius ? { sourceRadius } : {}), ...(falloff ? { falloff } : {}), ...(innerAngle ? { innerAngle } : {}), ...(outerAngle ? { outerAngle } : {}), ...(value.lightType ? { lightType: value.lightType as LightEffectDefinitionV1["lightType"] } : {}), radiusOperation: value.radiusOperation as LightEffectDefinitionV1["radiusOperation"] ?? "set", rotationBehavior: value.rotationBehavior as LightEffectDefinitionV1["rotationBehavior"] ?? "target", ...(value.rotation !== undefined ? { rotation: value.rotation } : {}), ...(value.action === "spotlight" ? { spotlightAngle, spotlightSpeed } : {}) };
  }
  // Compatibility migration for detector metadata written before the generic provider model.
  if (value.type === "emanation") {
    if (!id(value.presetName) || typeof value.removeAllOnDeactivate !== "boolean") return null;
    return {
      id: value.id,
      ...named,
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
      ...named,
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
  if (value.colorGradient !== undefined && (!record(value.colorGradient) || !color(value.colorGradient.minColor))) return null;
  const colorGradient = value.colorGradient as { minColor: string } | undefined;
  const shapes: ShaderShape[] = ["circle", "square"];
  if (value.shape !== undefined && !shapes.includes(value.shape as ShaderShape)) return null;
  const placements: ShaderPlacement[] = ["above", "below"];
  if (value.placement !== undefined && !placements.includes(value.placement as ShaderPlacement)) return null;
  if (!finite(value.maxIntensity) || value.maxIntensity < 0 || value.maxIntensity > 2) return null;
  if (value.intensityStrengthLinked !== undefined && typeof value.intensityStrengthLinked !== "boolean") return null;
  if (value.alwaysIncludeGm !== undefined && typeof value.alwaysIncludeGm !== "boolean") return null;
  if (!finite(value.spread) || value.spread <= 0 || value.spread > 4) return null;
  if (value.spreadStrengthLink !== undefined && !["min", "max"].includes(String(value.spreadStrengthLink))) return null;
  const dynamicBounds: Record<ShaderDynamicField, [number, number]> = {
    intensity: [0, 2], softness: [0.05, 4], innerRadius: [0, 199], outerRadius: [1, 200], beamWidth: [5, 120],
    width: [5, 400], height: [5, 400], offsetX: [-100, 100], offsetY: [-100, 100], responsiveOffset: [-100, 100],
    rotation: [-180, 180], animationRate: [0, 10], animationDepth: [0, 1], waveWidth: [0.05, 1],
  };
  const dynamicRanges: Partial<Record<ShaderDynamicField, DynamicValueRange>> = {};
  if (value.dynamicRanges !== undefined) {
    if (!record(value.dynamicRanges)) return null;
    for (const [field, candidate] of Object.entries(value.dynamicRanges)) {
      if (!(field in dynamicBounds) || !record(candidate) || !finite(candidate.minimum) || !finite(candidate.maximum)) return null;
      const [minimum, maximum] = dynamicBounds[field as ShaderDynamicField];
      if (candidate.minimum < minimum || candidate.minimum > maximum || candidate.maximum < minimum || candidate.maximum > maximum) return null;
      if (candidate.enabled !== undefined && typeof candidate.enabled !== "boolean") return null;
      dynamicRanges[field as ShaderDynamicField] = { minimum: candidate.minimum, maximum: candidate.maximum, ...(candidate.enabled === false ? { enabled: false } : {}) };
    }
  }
  let geometry: ShaderEffectDefinitionV1["geometry"];
  if (value.geometry !== undefined) {
    if (!record(value.geometry)) return null;
    const geometryValue = value.geometry;
    const { offsetX, offsetY, innerRadius, outerRadius } = geometryValue;
    if (!finite(offsetX) || !finite(offsetY) || !finite(innerRadius) || !finite(outerRadius)) return null;
    if (offsetX < -100 || offsetX > 100 || offsetY < -100 || offsetY > 100) return null;
    if (innerRadius < 0 || outerRadius <= innerRadius || outerRadius > 200) return null;
    const width = geometryValue.width ?? 100;
    const height = geometryValue.height ?? 100;
    const responsiveOffset = geometryValue.responsiveOffset ?? 0;
    const rotation = geometryValue.rotation ?? 0;
    if (!finite(width) || !finite(height) || !finite(responsiveOffset) || !finite(rotation)) return null;
    if (width < 5 || width > 400 || height < 5 || height > 400 || responsiveOffset < -100 || responsiveOffset > 100 || rotation < -180 || rotation > 180) return null;
    let responsiveOffsetRange: DynamicValueRange | undefined;
    if (geometryValue.responsiveOffsetRange !== undefined) {
      if (!record(geometryValue.responsiveOffsetRange)) return null;
      const range = geometryValue.responsiveOffsetRange;
      if (finite(range.minimum) && finite(range.maximum)) {
        if (range.minimum < -100 || range.minimum > 100 || range.maximum < -100 || range.maximum > 100) return null;
        responsiveOffsetRange = { minimum: range.minimum, maximum: range.maximum };
      } else {
        // Migrate the experimental sorted endpoints plus REV representation.
        if (!finite(range.min) || !finite(range.max) || range.min < -100 || range.max > 100 || range.min > range.max) return null;
        if (range.reversed !== undefined && typeof range.reversed !== "boolean") return null;
        responsiveOffsetRange = range.reversed ? { minimum: range.max, maximum: range.min } : { minimum: range.min, maximum: range.max };
      }
    }
    if (geometryValue.responsiveOffsetDynamic !== undefined && typeof geometryValue.responsiveOffsetDynamic !== "boolean") return null;
    if (!dynamicRanges.responsiveOffset && responsiveOffsetRange) dynamicRanges.responsiveOffset = { ...responsiveOffsetRange, ...(geometryValue.responsiveOffsetDynamic === false ? { enabled: false } : {}) };
    const linkFields = ["offsetXStrengthLink", "offsetYStrengthLink", "innerRadiusStrengthLink", "outerRadiusStrengthLink", "widthStrengthLink", "heightStrengthLink", "rotationStrengthLink"] as const;
    for (const field of linkFields) if (geometryValue[field] !== undefined && !["min", "max"].includes(String(geometryValue[field]))) return null;
    geometry = {
      offsetX, offsetY, responsiveOffset, innerRadius, outerRadius, width, height, rotation,
      ...Object.fromEntries(linkFields.filter((field) => geometryValue[field] !== undefined).map((field) => [field, geometryValue[field]])),
    };
  }
  let animation: ShaderEffectDefinitionV1["animation"];
  if (value.animation !== undefined) {
    if (!record(value.animation) || !finite(value.animation.rate) || !finite(value.animation.depth)) return null;
    if (value.animation.rate < 0 || value.animation.rate > 10 || value.animation.depth < 0 || value.animation.depth > 1) return null;
    if (value.animation.rateStrengthLink !== undefined && !["min", "max"].includes(String(value.animation.rateStrengthLink))) return null;
    if (value.animation.depthStrengthLink !== undefined && !["min", "max"].includes(String(value.animation.depthStrengthLink))) return null;
    const inferredMode = legacyPreset === "pulse" || legacyPreset === "flicker" ? legacyPreset : "none";
    const modes: ShaderAnimationMode[] = ["none", "pulse", "flicker", "radial-pulse"];
    if (value.animation.mode !== undefined && !modes.includes(value.animation.mode as ShaderAnimationMode)) return null;
    if (value.animation.radialDirection !== undefined && !["outward", "inward"].includes(String(value.animation.radialDirection))) return null;
    if (value.animation.waveWidth !== undefined && (!finite(value.animation.waveWidth) || value.animation.waveWidth < 0.05 || value.animation.waveWidth > 1)) return null;
    if (value.animation.waveWidthStrengthLink !== undefined && !["min", "max"].includes(String(value.animation.waveWidthStrengthLink))) return null;
    if (value.animation.waveWidthStrengthLink !== undefined && value.animation.waveWidth === undefined) return null;
    animation = {
      mode: value.animation.mode as ShaderAnimationMode ?? inferredMode,
      rate: value.animation.rate,
      ...(value.animation.rateStrengthLink !== undefined ? { rateStrengthLink: value.animation.rateStrengthLink as "min" | "max" } : {}),
      depth: value.animation.depth,
      ...(value.animation.depthStrengthLink !== undefined ? { depthStrengthLink: value.animation.depthStrengthLink as "min" | "max" } : {}),
      ...(value.animation.radialDirection !== undefined ? { radialDirection: value.animation.radialDirection as "outward" | "inward" } : {}),
      ...(value.animation.waveWidth !== undefined ? { waveWidth: value.animation.waveWidth } : {}),
      ...(value.animation.waveWidthStrengthLink !== undefined ? { waveWidthStrengthLink: value.animation.waveWidthStrengthLink as "min" | "max" } : {}),
    };
  } else if (legacyPreset === "pulse" || legacyPreset === "flicker") {
    animation = { mode: legacyPreset, rate: 1, depth: 0.35 };
  }
  let beamWidth: number | undefined;
  if (value.beamWidth !== undefined) {
    if (!finite(value.beamWidth) || value.beamWidth < 5 || value.beamWidth > 120) return null;
    beamWidth = value.beamWidth;
  }
  if (value.beamWidthStrengthLink !== undefined && !["min", "max"].includes(String(value.beamWidthStrengthLink))) return null;
  if (value.beamWidthStrengthLink !== undefined && value.beamWidth === undefined) return null;
  return {
    id: value.id,
    ...named,
    type: "shader",
    enabled: value.enabled,
    target,
    audience,
    preset: legacyPreset ? "glow" : value.preset as ShaderPreset,
    shape: value.shape as ShaderShape ?? "circle",
    placement: value.placement as ShaderPlacement ?? "above",
    color: value.color.toLowerCase(),
    ...(colorGradient ? { colorGradient: { minColor: colorGradient.minColor.toLowerCase() } } : {}),
    // Preserve the old outline's approximate opacity and feather width while
    // migrating it to the unified glow shader.
    maxIntensity: legacyPreset === "outline"
      ? Math.min(2, value.maxIntensity * (0.95 / 0.62))
      : legacyPreset === "pulse" || legacyPreset === "flicker"
        ? Math.min(2, value.maxIntensity * (0.72 / 0.62))
        : value.maxIntensity,
    ...(value.intensityStrengthLinked !== undefined ? { intensityStrengthLinked: value.intensityStrengthLinked } : {}),
    ...(value.alwaysIncludeGm !== undefined ? { alwaysIncludeGm: value.alwaysIncludeGm } : {}),
    spread: legacyPreset === "outline" ? Math.max(0.05, value.spread * 0.12) : value.spread,
    ...(value.spreadStrengthLink !== undefined ? { spreadStrengthLink: value.spreadStrengthLink as "min" | "max" } : {}),
    ...(Object.keys(dynamicRanges).length ? { dynamicRanges } : {}),
    ...(geometry ? { geometry } : {}),
    ...(beamWidth !== undefined ? { beamWidth } : {}),
    ...(value.beamWidthStrengthLink !== undefined ? { beamWidthStrengthLink: value.beamWidthStrengthLink as "min" | "max" } : {}),
    ...(animation ? { animation } : {}),
  };
}

export function parseDetectionRule(value: unknown): DetectionRuleV1 | null {
  if (!record(value) || !id(value.id) || typeof value.enabled !== "boolean") return null;
  if (value.name !== undefined && (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 80)) return null;
  if (value.matchType !== undefined && !["exact", "wildcard", "regex"].includes(String(value.matchType))) return null;
  const matchType = value.matchType as DetectionRuleV1["matchType"] ?? "exact";
  const usesNaturalText = record(value.source) && ["item-name", "item-label"].includes(String(value.source.type));
  const signal = typeof value.signal === "string" ? matchType === "exact" && !usesNaturalText ? normalizeSignal(value.signal) : value.signal.trim() : "";
  const layers = ["MAP", "GRID", "DRAWING", "PROP", "MOUNT", "CHARACTER", "ATTACHMENT", "NOTE", "TEXT", "RULER", "FOG", "POINTER", "POST_PROCESS", "CONTROL", "POPOVER"] as const;
  if (value.excludeLayers !== undefined && (!Array.isArray(value.excludeLayers) || value.excludeLayers.some((layer) => !layers.includes(layer as typeof layers[number])))) return null;
  const excludeLayers = [...new Set((value.excludeLayers as DetectionRuleV1["excludeLayers"] | undefined) ?? [])];
  let source: DetectionRuleV1["source"];
  if (value.source !== undefined) {
    if (!record(value.source) || !["sting-emitter", "item-name", "item-label", "obr-light"].includes(String(value.source.type))) return null;
    if (value.source.type === "obr-light") {
      if (!["distance", "within-radius"].includes(String(value.source.detection))) return null;
      if (value.source.lightType !== undefined && !["PRIMARY", "SECONDARY", "AUXILIARY"].includes(String(value.source.lightType))) return null;
      if (value.source.ownership !== undefined && !["any", "sting", "external"].includes(String(value.source.ownership))) return null;
      if (value.source.attachment !== undefined && !["any", "attached", "unattached"].includes(String(value.source.attachment))) return null;
      source = { type: "obr-light", detection: value.source.detection as "distance" | "within-radius", ...(value.source.lightType ? { lightType: value.source.lightType as "PRIMARY" | "SECONDARY" | "AUXILIARY" } : {}), ...(value.source.ownership ? { ownership: value.source.ownership as "any" | "sting" | "external" } : {}), ...(value.source.attachment ? { attachment: value.source.attachment as "any" | "attached" | "unattached" } : {}) };
    } else source = { type: value.source.type as "sting-emitter" | "item-name" | "item-label" };
  }
  if ((!signal && source?.type !== "obr-light") || !["nearest", "all"].includes(String(value.aggregation)) || !["binary", "linear", "smoothstep", "logarithmic"].includes(String(value.falloff))) return null;
  if (value.ignoreHidden !== undefined && typeof value.ignoreHidden !== "boolean") return null;
  if (!record(value.range) || !finite(value.range.outer) || !finite(value.range.inner)) return null;
  if (value.range.outer <= 0 || value.range.inner < 0 || value.range.inner > value.range.outer) return null;
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
    ...(value.name !== undefined ? { name: (value.name as string).trim() } : {}),
    enabled: value.enabled,
    signal,
    ...(source ? { source } : {}),
    matchType,
    excludeLayers,
    range: { outer: value.range.outer, inner: value.range.inner },
    aggregation: value.aggregation as DetectionRuleV1["aggregation"],
    ignoreHidden: value.ignoreHidden ?? false,
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

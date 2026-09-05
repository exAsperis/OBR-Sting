import OBR, { buildBillboard, buildEffect, buildImage, isImage, isLight, type Billboard, type BoundingBox, type Effect, type GridType, type Image, type Item } from "@owlbear-rodeo/sdk";
import { LOCAL_EFFECT_KEY } from "../../constants";
import type { DesiredEffect, ShaderDynamicField, ShaderEffectDefinitionV1, StrengthLinkDirection } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";
import { resolveShaderGeometry } from "./geometry";
import { GRID_MARKER_CAPACITY, RADAR_ECHO_CAPACITY, SHADERS } from "./shaders";
import { edgeIndicatorLayout, transformedBounds, type EdgeIndicatorLayout } from "./edgeGeometry";

interface RadarCandidate { id: string; position: { x: number; y: number }; phase: number; size: number; rune: number; color: { x: number; y: number; z: number } }
interface RadarEcho { position: { x: number; y: number }; refreshedAt: number; size: number; rune: number; color: { x: number; y: number; z: number } }
interface RadarRuntime {
  candidates: RadarCandidate[];
  echoes: Map<string, RadarEcho>;
  lastPhase: number;
  phaseOrigin: number;
  effect: ShaderEffectDefinitionV1;
  strength: number;
  colorStrength: number;
  scale: number;
}

interface RuntimeState {
  localItemId: string;
  strength: number;
  configHash: string;
  preset: ShaderEffectDefinitionV1["preset"];
  layoutHash: string;
  radar?: RadarRuntime;
  gridImages?: Map<string, string>;
  edge?: EdgeRuntime;
}

interface EdgeRuntime {
  effect: ShaderEffectDefinitionV1;
  strength: number;
  targetBounds: BoundingBox;
  emitterBounds: BoundingBox;
  emitter: Item;
  imageId?: string;
  imageScale?: number;
  imageCircleDiameter?: number;
  layoutHash?: string;
}

export interface GridImageLayout {
  center: { x: number; y: number };
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
}

const EPSILON = 0.005;
const itemCenter = async (item: Item): Promise<{ x: number; y: number }> => isLight(item) ? item.position : (await OBR.scene.items.getItemBounds([item.id])).center;
const itemBounds = async (item: Item): Promise<BoundingBox> => isLight(item)
  ? { center: item.position, width: 0, height: 0, min: item.position, max: item.position }
  : OBR.scene.items.getItemBounds([item.id]);
export const DEFAULT_RADAR = { echoStyle: "circle", echoSize: 100, distanceScale: "linear", decoration: "none", sweepTrail: 0, brightness: 0.35, sweepType: "none", sweepDirection: "outward", echoFadeDuration: 3 } as const;

export function radarSweepIsAnimated(effect: ShaderEffectDefinitionV1): boolean {
  return (effect.radar?.sweepType ?? DEFAULT_RADAR.sweepType) !== "none";
}

export function circularPhaseCrossed(previous: number, current: number, target: number): boolean {
  if (current >= previous) return target > previous && target <= current;
  return target > previous || target <= current;
}

export function radarDistancePosition(distance: number, outerRange: number, innerRadius: number, outerRadius: number, scale: "linear" | "logarithmic" = "linear"): number {
  const linear = Math.max(0, Math.min(1, distance / Math.max(outerRange, 0.0001)));
  const normalized = scale === "logarithmic" ? Math.log10(1 + 9 * linear) : linear;
  return innerRadius + (outerRadius - innerRadius) * normalized;
}

export function gridWorldRange(outerRange: number, dpi: number, scaleMultiplier: number): number {
  return outerRange / Math.max(scaleMultiplier, Number.EPSILON) * Math.max(dpi, 1);
}

export function gridLocalValue(worldValue: number, worldRange: number, outerRadius: number): number {
  return worldValue / Math.max(worldRange, Number.EPSILON) * outerRadius;
}

export function gridImageLayout(
  effectLayout: { width: number; height: number; position: { x: number; y: number } },
  position: { x: number; y: number },
  halfSize: { x: number; y: number },
  geometry: ReturnType<typeof resolveShaderGeometry>,
  scale: number,
  shape: ShaderEffectDefinitionV1["shape"],
): GridImageLayout {
  const effectSize = { x: geometry.width / 100, y: geometry.height / 100 };
  const angle = geometry.rotation * Math.PI / 180;
  const x = position.x * effectSize.x;
  const y = position.y * effectSize.y;
  const normalized = {
    x: geometry.offsetX / 100 / scale + Math.cos(angle) * x - Math.sin(angle) * y,
    y: geometry.offsetY / 100 / scale + Math.sin(angle) * x + Math.cos(angle) * y,
  };
  const metric = shape === "square" ? Math.max(Math.abs(position.x), Math.abs(position.y)) : Math.hypot(position.x, position.y);
  return {
    center: {
      x: effectLayout.position.x + effectLayout.width * (0.5 + normalized.x / 2),
      y: effectLayout.position.y + effectLayout.height * (0.5 + normalized.y / 2),
    },
    width: halfSize.x * 2 * effectSize.x * effectLayout.width,
    height: halfSize.y * 2 * effectSize.y * effectLayout.height,
    rotation: geometry.rotation,
    visible: metric >= geometry.innerRadius / 100 / scale && metric <= geometry.outerRadius / 100 / scale,
  };
}

export const gridTypeValue = (type: GridType): number => ({ SQUARE: 0, HEX_VERTICAL: 1, HEX_HORIZONTAL: 2, DIMETRIC: 3, ISOMETRIC: 4 })[type];

export function radarEchoSize(emitterArea: number, targetArea: number, basePercent = 100): number {
  const relativeSize = Math.max(0.012 / 0.028, Math.min(0.12 / 0.028, Math.sqrt(Math.max(1, emitterArea) / Math.max(1, targetArea))));
  return 0.028 * basePercent / 100 * relativeSize;
}

export function resolveRadarEchoSize(effect: ShaderEffectDefinitionV1, detectionStrength: number, emitterArea: number, targetArea: number): number {
  const base = resolveDynamicValue(effect, "radarEchoSize", effect.radar?.echoSize ?? DEFAULT_RADAR.echoSize, detectionStrength, undefined, 10, 400);
  return radarEchoSize(emitterArea, targetArea, base);
}

export function resolveStrengthLinkedValue(value: number, link: StrengthLinkDirection | undefined, strength: number, min: number, max: number): number {
  if (!link) return value;
  const clampedStrength = Math.max(0, Math.min(1, strength));
  const lowStrengthValue = link === "max" ? min : max;
  return lowStrengthValue + (value - lowStrengthValue) * clampedStrength;
}

export function resolveStrengthLinkedRate(rate: number, link: StrengthLinkDirection | undefined, strength: number): number {
  return resolveStrengthLinkedValue(rate, link, strength, 0, 10);
}

export function resolveDynamicValue(effect: ShaderEffectDefinitionV1, field: ShaderDynamicField, value: number, strength: number, legacyLink?: StrengthLinkDirection, min = 0, max = 1): number {
  const range = effect.dynamicRanges?.[field];
  if (range) {
    if (range.enabled === false) return value;
    const clampedStrength = Math.max(0, Math.min(1, strength));
    return range.minimum + (range.maximum - range.minimum) * clampedStrength;
  }
  return resolveStrengthLinkedValue(value, legacyLink, strength, min, max);
}

function colorVector(hex: string) {
  return {
    x: Number.parseInt(hex.slice(1, 3), 16) / 255,
    y: Number.parseInt(hex.slice(3, 5), 16) / 255,
    z: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

export function resolveStrengthLinkedShaderValues(effect: ShaderEffectDefinitionV1, strength: number) {
  const configured = resolveShaderGeometry(effect);
  const geometry = {
    ...configured,
    offsetX: resolveDynamicValue(effect, "offsetX", configured.offsetX, strength, configured.offsetXStrengthLink, -100, 100),
    offsetY: resolveDynamicValue(effect, "offsetY", configured.offsetY, strength, configured.offsetYStrengthLink, -100, 100),
    responsiveOffset: resolveDynamicValue(effect, "responsiveOffset", configured.responsiveOffset, strength, undefined, -100, 100),
    width: resolveDynamicValue(effect, "width", configured.width, strength, configured.widthStrengthLink, 5, 400),
    height: resolveDynamicValue(effect, "height", configured.height, strength, configured.heightStrengthLink, 5, 400),
    rotation: resolveDynamicValue(effect, "rotation", configured.rotation, strength, configured.rotationStrengthLink, -180, 180),
    innerRadius: resolveDynamicValue(effect, "innerRadius", configured.innerRadius, strength, configured.innerRadiusStrengthLink, 0, Math.max(0, configured.outerRadius - 1)),
    outerRadius: resolveDynamicValue(effect, "outerRadius", configured.outerRadius, strength, configured.outerRadiusStrengthLink, configured.innerRadius + 1, 200),
  };
  geometry.outerRadius = Math.max(geometry.innerRadius + 1, geometry.outerRadius);
  geometry.innerRadius = Math.min(geometry.innerRadius, geometry.outerRadius - 1);
  return {
    geometry,
    spread: resolveDynamicValue(effect, "softness", effect.spread, strength, effect.spreadStrengthLink, 0, 4),
    beamWidth: resolveDynamicValue(effect, "beamWidth", effect.beamWidth ?? 38, strength, effect.beamWidthStrengthLink, 0, 120),
    beamOriginWidth: resolveDynamicValue(effect, "beamOriginWidth", effect.beamOriginWidth ?? 0, strength, undefined, 0, 100),
  };
}

export function resolveEdgeSize(effect: ShaderEffectDefinitionV1, strength: number): number {
  return resolveDynamicValue(effect, "indicatorSize", effect.edge?.size ?? 48, strength, undefined, 16, 160);
}

export function edgeImageScale(image: { width: number; height: number }, circleDiameter: number): number {
  return circleDiameter / Math.max(Math.hypot(image.width, image.height), 1);
}

export function calibrateEdgeImageScale(seedScale: number, circleDiameter: number, renderedDiagonal: number): number {
  return seedScale * circleDiameter / Math.max(renderedDiagonal, 1);
}

export function edgeFootprintSize(effect: ShaderEffectDefinitionV1, strength: number): number {
  const circleDiameter = resolveEdgeSize(effect, strength);
  const geometry = resolveStrengthLinkedShaderValues(effect, strength).geometry;
  const scaledDiameter = circleDiameter * Math.max(geometry.width, geometry.height) / 100;
  return effect.edge?.appearance === "image" ? scaledDiameter * Math.SQRT2 : scaledDiameter;
}

export function rotateEdgeDirection(direction: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return { x: direction.x * cosine - direction.y * sine, y: direction.x * sine + direction.y * cosine };
}

export function runeValueFromId(id: string): number {
  const first = id.trim().charAt(0);
  const hexadecimal = Number.parseInt(first, 16);
  if (/^[0-9a-f]$/i.test(first) && Number.isFinite(hexadecimal)) return hexadecimal;
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 16;
}

function edgeUniforms(effect: ShaderEffectDefinitionV1, strength: number, layout: EdgeIndicatorLayout = { center: { x: 0, y: 0 }, direction: { x: 0, y: -1 }, visible: false }, rune = 0) {
  const animationModes = { none: 0, pulse: 1, flicker: 2, "radial-pulse": 3 } as const;
  const geometry = resolveStrengthLinkedShaderValues(effect, strength).geometry;
  return [
    { name: "signalColor", value: resolveSignalColor(effect, strength) },
    { name: "strength", value: resolveEffectIntensity(effect, strength) },
    { name: "rate", value: resolveDynamicValue(effect, "animationRate", effect.animation?.rate ?? 1, strength, effect.animation?.rateStrengthLink, 0, 10) },
    { name: "depth", value: resolveDynamicValue(effect, "animationDepth", effect.animation?.depth ?? 0, strength, effect.animation?.depthStrengthLink, 0, 1) },
    { name: "animationMode", value: animationModes[effect.animation?.mode ?? "none"] },
    { name: "radialDirection", value: effect.animation?.radialDirection === "inward" ? -1 : 1 },
    { name: "waveWidth", value: resolveDynamicValue(effect, "waveWidth", effect.animation?.waveWidth ?? 0.22, strength, effect.animation?.waveWidthStrengthLink, 0, 1) },
    { name: "spread", value: resolveDynamicValue(effect, "softness", effect.spread, strength, effect.spreadStrengthLink, 0, 4) },
    { name: "indicatorCenter", value: layout.center },
    { name: "indicatorDirection", value: rotateEdgeDirection(layout.direction, geometry.rotation) },
    { name: "indicatorSize", value: resolveEdgeSize(effect, strength) },
    { name: "indicatorScale", value: { x: geometry.width / 100, y: geometry.height / 100 } },
    { name: "appearanceMode", value: ({ triangle: 0, disk: 1, image: 2, square: 3, target: 4, echo: 5, rune: 6, arcane: 7 } as const)[effect.edge?.appearance ?? "triangle"] },
    { name: "indicatorRune", value: rune },
    { name: "indicatorVisible", value: layout.visible ? 1 : 0 },
  ];
}

export function resolveRadarFadeDuration(effect: ShaderEffectDefinitionV1, strength: number): number {
  return resolveDynamicValue(effect, "echoFadeDuration", effect.radar?.echoFadeDuration ?? DEFAULT_RADAR.echoFadeDuration, strength, undefined, 0.1, 30);
}

export function resolveSignalColor(effect: ShaderEffectDefinitionV1, strength: number) {
  const max = colorVector(effect.color);
  if (!effect.colorGradient) return max;
  const min = colorVector(effect.colorGradient.minColor);
  const t = Math.max(0, Math.min(1, strength));
  return { x: min.x + (max.x - min.x) * t, y: min.y + (max.y - min.y) * t, z: min.z + (max.z - min.z) * t };
}

export function resolveEffectIntensity(effect: ShaderEffectDefinitionV1, strength: number): number {
  if (effect.dynamicRanges?.intensity) return resolveDynamicValue(effect, "intensity", effect.maxIntensity, strength, undefined, 0, 2);
  return (effect.intensityStrengthLinked ?? true) ? strength * effect.maxIntensity : effect.maxIntensity;
}

function effectScale(effect: ShaderEffectDefinitionV1, resolved: ReturnType<typeof resolveStrengthLinkedShaderValues>): number {
  const { geometry } = resolved;
  const feather = resolved.spread === 0 ? 0 : effect.preset === "beam"
    ? Math.min(0.12, Math.max(0.008, 0.025 * resolved.spread))
    : Math.min(0.45, Math.max(0.005, 0.1 * resolved.spread));
  const axisScale = Math.max(geometry.width, geometry.height) / 100;
  const offsetScale = (Math.max(Math.abs(geometry.offsetX), Math.abs(geometry.offsetY)) + Math.abs(geometry.responsiveOffset)) / 100;
  return Math.max(1, geometry.outerRadius / 100 * axisScale + offsetScale + feather);
}

function layout(bounds: BoundingBox, scale: number) {
  const width = Math.max(1, bounds.width * scale);
  const height = Math.max(1, bounds.height * scale);
  return {
    width,
    height,
    position: { x: bounds.center.x - width / 2, y: bounds.center.y - height / 2 },
  };
}

export function shaderUniforms(effect: ShaderEffectDefinitionV1, strength: number, scale: number, direction: { x: number; y: number }, resolved = resolveStrengthLinkedShaderValues(effect, strength), responsiveDirection = direction, colorStrength = strength) {
  const { geometry } = resolved;
  const animationModes = { none: 0, pulse: 1, flicker: 2, "radial-pulse": 3 } as const;
  const values = [
    { name: "signalColor", value: resolveSignalColor(effect, colorStrength) },
    { name: "strength", value: resolveEffectIntensity(effect, strength) },
    { name: "rate", value: resolveDynamicValue(effect, "animationRate", effect.animation?.rate ?? 1, strength, effect.animation?.rateStrengthLink, 0, 10) },
    { name: "depth", value: resolveDynamicValue(effect, "animationDepth", effect.animation?.depth ?? 0, strength, effect.animation?.depthStrengthLink, 0, 1) },
    { name: "animationMode", value: animationModes[effect.animation?.mode ?? "none"] },
    { name: "radialDirection", value: effect.animation?.radialDirection === "inward" ? -1 : 1 },
    { name: "waveWidth", value: resolveDynamicValue(effect, "waveWidth", effect.animation?.waveWidth ?? 0.22, strength, effect.animation?.waveWidthStrengthLink, 0, 1) },
    { name: "spread", value: resolved.spread },
    { name: "shapeMode", value: effect.shape === "square" ? 1 : 0 },
    { name: "centerOffset", value: {
      x: (geometry.offsetX + (effect.preset === "glow" ? responsiveDirection.x * geometry.responsiveOffset : 0)) / 100 / scale,
      y: (geometry.offsetY + (effect.preset === "glow" ? responsiveDirection.y * geometry.responsiveOffset : 0)) / 100 / scale,
    } },
    { name: "innerRadius", value: geometry.innerRadius / 100 / scale },
    { name: "outerRadius", value: geometry.outerRadius / 100 / scale },
    { name: "effectSize", value: { x: geometry.width / 100, y: geometry.height / 100 } },
    { name: "effectRotation", value: geometry.rotation * Math.PI / 180 },
  ];
  if (effect.preset === "beam") {
    const localDirection = {
      x: direction.x / (geometry.width / 100),
      y: direction.y / (geometry.height / 100),
    };
    const localDirectionLength = Math.hypot(localDirection.x, localDirection.y) || 1;
    values.push({ name: "beamDirection", value: { x: localDirection.x / localDirectionLength, y: localDirection.y / localDirectionLength } });
    values.push({ name: "beamWidth", value: resolved.beamWidth });
    values.push({ name: "beamOriginWidth", value: resolved.beamOriginWidth / 100 / scale / (geometry.width / 100) });
  }
  if (effect.preset === "glow") {
    values.push({ name: "segmentCount", value: Math.round(resolveDynamicValue(effect, "segments", effect.glow?.segments ?? 1, strength, undefined, 1, 30)) });
    values.push({ name: "segmentAlignment", value: effect.glow?.segmentAlignment === "boundary" ? 1 : 0 });
    values.push({ name: "signalDirection", value: direction });
  }
  if (effect.preset === "radar") {
    for (const name of ["rate", "animationMode", "radialDirection"]) {
      const index = values.findIndex((uniform) => uniform.name === name);
      if (index >= 0) values.splice(index, 1);
    }
    values.push({ name: "sweepPhase", value: 0 });
    values.push({ name: "sweepType", value: effect.radar?.sweepType === "none" ? -1 : effect.radar?.sweepType === "angular" ? 1 : 0 });
    values.push({ name: "sweepDirection", value: ["inward", "counterclockwise"].includes(effect.radar?.sweepDirection ?? "outward") ? -1 : 1 });
    values.push({ name: "echoStyle", value: effect.radar?.echoStyle === "rune" ? 2 : effect.radar?.echoStyle === "blob" ? 1 : 0 });
    values.push({ name: "decorationMode", value: ({ none: 0, m314: 1, modern: 2, arcane: 3 } as const)[effect.radar?.decoration ?? "none"] });
    values.push({ name: "trailEnabled", value: resolveDynamicValue(effect, "radarSweepTrail", effect.radar?.sweepTrail ?? DEFAULT_RADAR.sweepTrail, strength, undefined, 0, 100) / 100 });
    values.push({ name: "brightness", value: resolveDynamicValue(effect, "radarBrightness", effect.radar?.brightness ?? DEFAULT_RADAR.brightness, strength, undefined, 0, 1) });
    for (let index = 0; index < RADAR_ECHO_CAPACITY; index += 1) {
      values.push({ name: `echoPosition${index}`, value: { x: 0, y: 0 } });
      values.push({ name: `echoIntensity${index}`, value: 0 });
      values.push({ name: `echoSize${index}`, value: 0.028 });
      values.push({ name: `echoRune${index}`, value: index % 16 });
      values.push({ name: `echoColor${index}`, value: resolveSignalColor(effect, 0) });
    }
  }
  if (effect.preset === "grid") {
    values.push({ name: "showGrid", value: effect.grid?.showGrid ? 1 : 0 });
    values.push({ name: "gridType", value: 0 });
    values.push({ name: "gridDpi", value: 100 });
    values.push({ name: "worldRange", value: 100 });
    values.push({ name: "worldOrigin", value: { x: 0, y: 0 } });
    for (let index = 0; index < GRID_MARKER_CAPACITY; index += 1) {
      values.push({ name: `markerDataA${index}`, value: { x: 0, y: 0, z: 0 } });
      values.push({ name: `markerDataB${index}`, value: { x: 0, y: 0, z: 0 } });
      values.push({ name: `markerDataC${index}`, value: { x: 0, y: 1, z: 0 } });
      values.push({ name: `markerDataD${index}`, value: { x: 0, y: Math.PI * 2, z: Math.PI * 2 } });
      values.push({ name: `markerColor${index}`, value: resolveSignalColor(effect, 0) });
    }
  }
  return values;
}

export function shaderConfigHash(effect: ShaderEffectDefinitionV1): string {
  return JSON.stringify([effect.preset, effect.shape, effect.placement, effect.color, effect.colorGradient, effect.maxIntensity, effect.intensityStrengthLinked, effect.spread, effect.spreadStrengthLink, effect.dynamicRanges, effect.geometry, effect.beamWidth, effect.beamWidthStrengthLink, effect.beamOriginWidth, effect.glow, effect.radar, effect.grid, effect.edge, effect.animation]);
}

export function shaderZIndexForTarget(targetZIndex: number, _runtimeKey: string, placement: ShaderEffectDefinitionV1["placement"]): number {
  return targetZIndex + (placement === "above" ? 1 : -1);
}

export function averageDetectionDirections(origin: { x: number; y: number }, detections: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (!detections.length) return { x: 0, y: 0 };
  const sum = detections.reduce((vector, detection) => {
    const x = detection.x - origin.x;
    const y = detection.y - origin.y;
    const length = Math.hypot(x, y);
    if (length > 0) { vector.x += x / length; vector.y += y / length; }
    return vector;
  }, { x: 0, y: 0 });
  return { x: sum.x / detections.length, y: sum.y / detections.length };
}

export class ShaderEffectExecutor implements EffectExecutor<ShaderEffectDefinitionV1> {
  readonly type = "shader" as const;
  readonly scope = "local" as const;
  private states = new Map<string, RuntimeState>();
  private initialized = false;
  private radarTimer: number | undefined;
  private radarTicking = false;
  private edgeTimer: number | undefined;
  private edgeTicking = false;

  private stateItemIds(state: RuntimeState): string[] {
    return [state.localItemId, ...(state.gridImages?.values() ?? []), ...(state.edge?.imageId ? [state.edge.imageId] : [])];
  }

  private ensureEdgeTimer(): void {
    if (this.edgeTimer !== undefined || ![...this.states.values()].some((state) => state.edge)) return;
    this.edgeTimer = window.setInterval(() => void this.tickEdges(), 50);
  }

  private stopEdgeTimerIfIdle(): void {
    if (this.edgeTimer === undefined || [...this.states.values()].some((state) => state.edge)) return;
    window.clearInterval(this.edgeTimer);
    this.edgeTimer = undefined;
  }

  private async tickEdges(): Promise<void> {
    if (this.edgeTicking) return;
    this.edgeTicking = true;
    try {
      const edgeStates = [...this.states.values()].filter((state): state is RuntimeState & { edge: EdgeRuntime } => !!state.edge);
      if (!edgeStates.length) { this.stopEdgeTimerIfIdle(); return; }
      const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
      await Promise.all(edgeStates.map(async (state) => {
        const runtime = state.edge;
        const target = runtime.targetBounds.center;
        const emitter = runtime.emitterBounds.center;
        const corners = [
          { x: runtime.emitterBounds.min.x, y: runtime.emitterBounds.min.y },
          { x: runtime.emitterBounds.max.x, y: runtime.emitterBounds.min.y },
          { x: runtime.emitterBounds.max.x, y: runtime.emitterBounds.max.y },
          { x: runtime.emitterBounds.min.x, y: runtime.emitterBounds.max.y },
        ];
        const [targetScreen, emitterScreen, ...screenCorners] = await Promise.all([target, emitter, ...corners].map((point) => OBR.viewport.transformPoint(point)));
        const viewport = { width, height };
        const emitterScreenBounds = transformedBounds(screenCorners);
        const layout = edgeIndicatorLayout(targetScreen, emitterScreen, emitterScreenBounds, viewport, edgeFootprintSize(runtime.effect, runtime.strength), runtime.effect.edge?.inset ?? 16, runtime.effect.edge?.orientation ?? "toward-detection");
        const hash = JSON.stringify(layout);
        if (hash === runtime.layoutHash) return;
        runtime.layoutHash = hash;
        await OBR.scene.local.updateItems<Effect>([state.localItemId], (items) => { for (const item of items) item.uniforms = edgeUniforms(runtime.effect, runtime.strength, layout, runeValueFromId(runtime.emitter.id)); });
        if (runtime.imageId) {
          const position = layout.visible ? await OBR.viewport.inverseTransformPoint(layout.center) : { x: 0, y: 0 };
          const circleDiameter = resolveEdgeSize(runtime.effect, runtime.strength);
          if (runtime.imageScale !== undefined && runtime.imageCircleDiameter && Math.abs(circleDiameter - runtime.imageCircleDiameter) > 0.01) {
            runtime.imageScale *= circleDiameter / runtime.imageCircleDiameter;
            runtime.imageCircleDiameter = circleDiameter;
          }
          const imageScale = runtime.imageScale ?? (isImage(runtime.emitter) ? edgeImageScale(runtime.emitter.image, circleDiameter) : 1);
          const geometry = resolveStrengthLinkedShaderValues(runtime.effect, runtime.strength).geometry;
          await OBR.scene.local.updateItems<Billboard>([runtime.imageId], (items) => { for (const item of items) { item.position = position; item.scale = { x: imageScale * geometry.width / 100, y: imageScale * geometry.height / 100 }; item.visible = layout.visible; } }, true);
        }
      }));
    } finally { this.edgeTicking = false; }
  }

  private ensureRadarTimer(): void {
    if (this.radarTimer !== undefined || ![...this.states.values()].some((state) => state.radar && radarSweepIsAnimated(state.radar.effect))) return;
    this.radarTimer = window.setInterval(() => void this.tickRadars(), 50);
  }

  private stopRadarTimerIfIdle(): void {
    if (this.radarTimer === undefined || [...this.states.values()].some((state) => state.radar && radarSweepIsAnimated(state.radar.effect))) return;
    window.clearInterval(this.radarTimer);
    this.radarTimer = undefined;
  }

  private radarPhase(radar: RadarRuntime, now: number): number {
    const rate = resolveDynamicValue(radar.effect, "animationRate", radar.effect.animation?.rate ?? 1, radar.strength, radar.effect.animation?.rateStrengthLink, 0, 10);
    const raw = ((now - radar.phaseOrigin) / 1000 * Math.max(0, rate)) % 1;
    return ["inward", "counterclockwise"].includes(radar.effect.radar?.sweepDirection ?? "outward") ? (1 - raw) % 1 : raw;
  }

  private async tickRadars(): Promise<void> {
    if (this.radarTicking) return;
    this.radarTicking = true;
    try {
      const now = performance.now();
      const expired: string[] = [];
      for (const [key, state] of this.states) {
        const radar = state.radar;
        if (!radar) continue;
        if (!radarSweepIsAnimated(radar.effect)) continue;
        const phase = this.radarPhase(radar, now);
        const reverse = ["inward", "counterclockwise"].includes(radar.effect.radar?.sweepDirection ?? "outward");
        for (const candidate of radar.candidates) {
          const crossed = reverse ? circularPhaseCrossed(phase, radar.lastPhase, candidate.phase) : circularPhaseCrossed(radar.lastPhase, phase, candidate.phase);
          if (crossed) radar.echoes.set(candidate.id, { position: candidate.position, refreshedAt: now, size: candidate.size, rune: candidate.rune, color: candidate.color });
        }
        radar.lastPhase = phase;
        const fade = resolveRadarFadeDuration(radar.effect, radar.strength) * 1000;
        for (const [id, echo] of radar.echoes) if (now - echo.refreshedAt >= fade) radar.echoes.delete(id);
        if (!radar.candidates.length && !radar.echoes.size) { expired.push(key); continue; }
        const resolved = resolveStrengthLinkedShaderValues(radar.effect, radar.strength);
        const uniforms = shaderUniforms(radar.effect, radar.strength, radar.scale, { x: 0, y: -1 }, resolved, { x: 0, y: -1 }, radar.colorStrength);
        const phaseUniform = uniforms.find((uniform) => uniform.name === "sweepPhase");
        if (phaseUniform) phaseUniform.value = phase;
        [...radar.echoes.values()].slice(0, RADAR_ECHO_CAPACITY).forEach((echo, index) => {
          const position = uniforms.find((uniform) => uniform.name === `echoPosition${index}`);
          const intensity = uniforms.find((uniform) => uniform.name === `echoIntensity${index}`);
          const size = uniforms.find((uniform) => uniform.name === `echoSize${index}`);
          const rune = uniforms.find((uniform) => uniform.name === `echoRune${index}`);
          const color = uniforms.find((uniform) => uniform.name === `echoColor${index}`);
          if (position) position.value = echo.position;
          if (intensity) intensity.value = Math.max(0, 1 - (now - echo.refreshedAt) / fade);
          if (size) size.value = echo.size;
          if (rune) rune.value = echo.rune;
          if (color) color.value = echo.color;
        });
        await OBR.scene.local.updateItems<Effect>([state.localItemId], (items) => { for (const item of items) item.uniforms = uniforms; });
      }
      if (expired.length) {
        await OBR.scene.local.deleteItems(expired.map((key) => this.states.get(key)!.localItemId));
        for (const key of expired) this.states.delete(key);
      }
      this.stopRadarTimerIfIdle();
    } finally { this.radarTicking = false; }
  }

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const desired = batch.desired;
    const needsGrid = desired.some((entry) => (entry.effect as ShaderEffectDefinitionV1).preset === "grid");
    const gridScene = needsGrid ? await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getType(), OBR.scene.grid.getScale()]) : null;
    if (!this.initialized) {
      const stale = (await OBR.scene.local.getItems()).filter((item) => item.metadata[LOCAL_EFFECT_KEY] !== undefined);
      if (stale.length) await OBR.scene.local.deleteItems(stale.map((item) => item.id));
      this.initialized = true;
    }
    const active = new Set(desired.map((entry) => entry.runtimeKey));
    const obsolete = [...this.states.entries()].filter(([key, state]) => !active.has(key) && (!state.radar || (state.radar.effect.radar?.sweepType ?? DEFAULT_RADAR.sweepType) === "none"));
    if (obsolete.length) {
      await OBR.scene.local.deleteItems(obsolete.flatMap(([, state]) => this.stateItemIds(state)));
      for (const [key] of obsolete) this.states.delete(key);
    }
    for (const [key, state] of this.states) if (!active.has(key) && state.radar) state.radar.candidates = [];

    for (const context of desired) {
      const effect = context.effect as ShaderEffectDefinitionV1;
      if (effect.preset === "edge") {
        const emitter = context.detectedEmitter;
        if (!emitter) continue;
        const hash = shaderConfigHash(effect);
        let existing = this.states.get(context.runtimeKey);
        if (existing && existing.preset !== "edge") {
          await OBR.scene.local.deleteItems(this.stateItemIds(existing));
          this.states.delete(context.runtimeKey);
          existing = undefined;
        }
        const [targetBounds, emitterBounds] = await Promise.all([itemBounds(context.target!), itemBounds(emitter)]);
        const wantsImage = effect.edge?.appearance === "image" && isImage(emitter) && !!emitter.image.url;
        const priorEmitter = existing?.edge?.emitter;
        const imageChanged = priorEmitter?.id !== emitter.id
          || (priorEmitter && isImage(priorEmitter) ? priorEmitter.image.url : undefined) !== (isImage(emitter) ? emitter.image.url : undefined)
          || existing?.configHash !== hash;
        if (existing?.edge?.imageId && (!wantsImage || imageChanged)) {
          await OBR.scene.local.deleteItems([existing.edge.imageId]);
          existing.edge.imageId = undefined;
          existing.edge.imageScale = undefined;
          existing.edge.imageCircleDiameter = undefined;
        }
        if (!existing) {
          const item = buildEffect()
            .name("Proximity Signal: edge")
            .effectType("VIEWPORT")
            .sksl(SHADERS.edge)
            .uniforms(edgeUniforms(effect, context.strength))
            .blendMode("SRC_OVER")
            .locked(true)
            .disableHit(true)
            .disableAutoZIndex(true)
            .layer("POPOVER")
            .metadata({ [LOCAL_EFFECT_KEY]: { runtimeKey: context.runtimeKey } })
            .build();
          await OBR.scene.local.addItems([item]);
          existing = { localItemId: item.id, strength: context.strength, configHash: hash, preset: "edge", layoutHash: "", edge: { effect, strength: context.strength, targetBounds, emitterBounds, emitter } };
          this.states.set(context.runtimeKey, existing);
        }
        const edgeRuntime = existing.edge!;
        edgeRuntime.effect = effect;
        edgeRuntime.strength = context.strength;
        edgeRuntime.targetBounds = targetBounds;
        edgeRuntime.emitterBounds = emitterBounds;
        edgeRuntime.emitter = emitter;
        existing.strength = context.strength;
        existing.configHash = hash;
        if (wantsImage && !edgeRuntime.imageId && isImage(emitter)) {
          const imageScale = edgeImageScale(emitter.image, resolveEdgeSize(effect, context.strength));
          const image = buildBillboard(emitter.image, emitter.grid)
            .name(`Edge Indicator: ${emitter.name}`)
            .position({ x: 0, y: 0 })
            .scale({ x: imageScale, y: imageScale })
            .visible(false)
            .locked(true)
            .disableHit(true)
            .disableAutoZIndex(true)
            .layer("POPOVER")
            .metadata({ [LOCAL_EFFECT_KEY]: { runtimeKey: context.runtimeKey, part: "image" } })
            .build();
          await OBR.scene.local.addItems([image]);
          edgeRuntime.imageId = image.id;
          const imageBounds = await OBR.scene.local.getItemBounds([image.id]);
          const [screenMin, screenMax] = await Promise.all([OBR.viewport.transformPoint(imageBounds.min), OBR.viewport.transformPoint(imageBounds.max)]);
          const renderedDiagonal = Math.hypot(screenMax.x - screenMin.x, screenMax.y - screenMin.y);
          const circleDiameter = resolveEdgeSize(effect, context.strength);
          const calibratedScale = calibrateEdgeImageScale(imageScale, circleDiameter, renderedDiagonal);
          edgeRuntime.imageScale = calibratedScale;
          edgeRuntime.imageCircleDiameter = circleDiameter;
          await OBR.scene.local.updateItems<Billboard>([image.id], (items) => { for (const item of items) item.scale = { x: calibratedScale, y: calibratedScale }; });
        }
        edgeRuntime.layoutHash = undefined;
        this.ensureEdgeTimer();
        await this.tickEdges();
        continue;
      }
      const bounds = await OBR.scene.items.getItemBounds([context.target!.id]);
      const aimTarget = context.detectedEmitter?.id === context.target!.id ? context.detector : context.detectedEmitter;
      const aimCenter = aimTarget ? await itemCenter(aimTarget) : bounds.center;
      const directionVector = {
        x: (aimCenter.x - bounds.center.x) / Math.max(bounds.width / 2, 1),
        y: (aimCenter.y - bounds.center.y) / Math.max(bounds.height / 2, 1),
      };
      const directionLength = Math.hypot(directionVector.x, directionVector.y) || 1;
      const direction = { x: directionVector.x / directionLength, y: directionVector.y / directionLength };
      const responsiveCenters = await Promise.all((context.responsiveEmitters ?? (context.detectedEmitter ? [context.detectedEmitter] : [])).map(itemCenter));
      const responsiveDirection = averageDetectionDirections(bounds.center, responsiveCenters);
      const radarColorStrength = ["radar", "grid"].includes(effect.preset) ? Math.max(context.strength, ...(context.responsiveDetections ?? []).map((detection) => detection.strength)) : context.strength;
      const resolved = resolveStrengthLinkedShaderValues(effect, context.strength);
      const scale = effectScale(effect, resolved);
      const effectLayout = layout(bounds, scale);
      const showGridImages = effect.preset === "grid" && (effect.grid?.showImages ?? false);
      const effectZIndex = showGridImages && effect.placement === "below"
        ? context.target!.zIndex - 2
        : shaderZIndexForTarget(context.target!.zIndex, context.runtimeKey, effect.placement);
      const effectLayer = context.target!.layer;
      const nextLayoutHash = JSON.stringify([effectLayout, direction, responsiveDirection, effectZIndex, effectLayer]);
      const hash = shaderConfigHash(effect);
      let existing = this.states.get(context.runtimeKey);
      // Owlbear does not reliably recompile SkSL when an existing Effect item's
      // source changes. Recreate on preset changes; uniform-only changes stay fast.
      if (existing && existing.preset !== effect.preset) {
        await OBR.scene.local.deleteItems(this.stateItemIds(existing));
        this.states.delete(context.runtimeKey);
        existing = undefined;
      }
      if (!existing) {
        const item = buildEffect()
          .name(`Proximity Signal: ${effect.preset}`)
          .effectType("STANDALONE")
          // Stage the local effect invisibly. Owlbear can briefly draw a newly
          // attached item at its default depth before applying its configured
          // z-index, which otherwise flashes below-target effects above artwork.
          .visible(false)
          .width(effectLayout.width)
          .height(effectLayout.height)
          .position(effectLayout.position)
          // Keep the local overlay in Owlbear's attachment graph so the native
          // movement interaction carries it with the target before the scene
          // item change is committed. Scale and rotation remain world-aligned;
          // the next reconciliation recalculates their exact layout.
          .attachedTo(context.target!.id)
          .disableAttachmentBehavior(["SCALE", "ROTATION"])
          .zIndex(effectZIndex)
          .sksl(SHADERS[effect.preset])
          .uniforms(shaderUniforms(effect, context.strength, scale, direction, resolved, responsiveDirection, radarColorStrength))
          .blendMode("SRC_OVER")
          .locked(true)
          .disableHit(true)
          .disableAutoZIndex(true)
          .layer(effectLayer)
          .metadata({ [LOCAL_EFFECT_KEY]: { runtimeKey: context.runtimeKey } })
          .build();
        await OBR.scene.local.addItems([item]);
        await OBR.scene.local.updateItems<Effect>([item.id], (items) => {
          for (const added of items) {
            added.zIndex = effectZIndex;
            added.layer = effectLayer;
            added.visible = true;
          }
        });
        const now = performance.now();
        const radar = effect.preset === "radar" ? { candidates: [], echoes: new Map<string, RadarEcho>(), lastPhase: 0, phaseOrigin: now, effect, strength: context.strength, colorStrength: radarColorStrength, scale } satisfies RadarRuntime : undefined;
        this.states.set(context.runtimeKey, { localItemId: item.id, strength: context.strength, configHash: hash, preset: effect.preset, layoutHash: nextLayoutHash, ...(radar ? { radar } : {}), ...(effect.preset === "grid" ? { gridImages: new Map() } : {}) });
        existing = this.states.get(context.runtimeKey);
      } else if (Math.abs(existing.strength - context.strength) >= EPSILON || existing.configHash !== hash || existing.layoutHash !== nextLayoutHash) {
        await OBR.scene.local.updateItems<Effect>([existing.localItemId], (items) => {
          for (const item of items) {
            item.width = effectLayout.width;
            item.height = effectLayout.height;
            item.position = effectLayout.position;
            item.zIndex = effectZIndex;
            item.layer = effectLayer;
            if ((effect.preset !== "radar" || radarSweepIsAnimated(effect)) && effect.preset !== "grid") item.uniforms = shaderUniforms(effect, context.strength, scale, direction, resolved, responsiveDirection, radarColorStrength);
          }
        });
        existing.strength = context.strength;
        existing.configHash = hash;
        existing.layoutHash = nextLayoutHash;
      }
      if (effect.preset === "radar" && existing?.radar) {
        const origin = await itemCenter(context.detector);
        const targetArea = Math.max(1, bounds.width * bounds.height);
        const geometry = resolved.geometry;
        const detections = [...(context.responsiveDetections ?? [])].sort((left, right) => left.distance - right.distance).slice(0, RADAR_ECHO_CAPACITY);
        const samples = await Promise.all(detections.map(async (detection) => {
          if (isLight(detection.emitter)) return { center: detection.emitter.position, area: targetArea };
          const emitterBounds = await OBR.scene.items.getItemBounds([detection.emitter.id]);
          return { center: emitterBounds.center, area: Math.max(1, emitterBounds.width * emitterBounds.height) };
        }));
        const sweepType = effect.radar?.sweepType ?? DEFAULT_RADAR.sweepType;
        existing.radar.candidates = detections.map((detection, index) => {
          const dx = samples[index].center.x - origin.x, dy = samples[index].center.y - origin.y;
          const length = Math.hypot(dx, dy) || 1;
          const radius = radarDistancePosition(detection.distance, context.rule.range.outer, geometry.innerRadius / 100 / scale, geometry.outerRadius / 100 / scale, effect.radar?.distanceScale ?? DEFAULT_RADAR.distanceScale);
          const unit = { x: dx / length, y: dy / length };
          const shapeMetric = effect.shape === "square" ? Math.max(Math.abs(unit.x), Math.abs(unit.y), 0.0001) : 1;
          const position = { x: unit.x * radius / shapeMetric, y: unit.y * radius / shapeMetric };
          const phase = sweepType === "radial" ? Math.max(0, Math.min(1, detection.distance / context.rule.range.outer)) : ((Math.atan2(position.x, -position.y) / (Math.PI * 2)) + 1) % 1;
          const echoSize = resolveRadarEchoSize(effect, detection.strength, samples[index].area, targetArea);
          return { id: detection.emitter.id, position, phase, size: echoSize, rune: runeValueFromId(detection.emitter.id), color: resolveSignalColor(effect, detection.strength) };
        });
        const previousSweepType = existing.radar.effect.radar?.sweepType ?? DEFAULT_RADAR.sweepType;
        if (previousSweepType === "none" && sweepType !== "none") {
          existing.radar.echoes.clear();
          existing.radar.lastPhase = 0;
          existing.radar.phaseOrigin = performance.now();
        }
        existing.radar.effect = effect;
        existing.radar.strength = context.strength;
        existing.radar.colorStrength = radarColorStrength;
        existing.radar.scale = scale;
        if (sweepType === "none") {
          const now = performance.now();
          existing.radar.echoes = new Map(existing.radar.candidates.map((candidate) => [candidate.id, { position: candidate.position, refreshedAt: now, size: candidate.size, rune: candidate.rune, color: candidate.color }]));
          const staticUniforms = shaderUniforms(effect, context.strength, scale, { x: 0, y: -1 }, resolved, { x: 0, y: -1 }, radarColorStrength);
          [...existing.radar.echoes.values()].forEach((echo, index) => {
            const position = staticUniforms.find((uniform) => uniform.name === `echoPosition${index}`);
            const intensity = staticUniforms.find((uniform) => uniform.name === `echoIntensity${index}`);
            const size = staticUniforms.find((uniform) => uniform.name === `echoSize${index}`);
            const rune = staticUniforms.find((uniform) => uniform.name === `echoRune${index}`);
            const color = staticUniforms.find((uniform) => uniform.name === `echoColor${index}`);
            if (position) position.value = echo.position;
            if (intensity) intensity.value = 1;
            if (size) size.value = echo.size;
            if (rune) rune.value = echo.rune;
            if (color) color.value = echo.color;
          });
          await OBR.scene.local.updateItems<Effect>([existing.localItemId], (items) => { for (const item of items) item.uniforms = staticUniforms; });
        }
      }
      if (effect.preset === "grid" && existing && gridScene) {
        const [gridDpi, sceneGridType, gridScale] = gridScene;
        const origin = await itemCenter(context.detector);
        const geometry = resolved.geometry;
        const localOuterRadius = geometry.outerRadius / 100 / scale;
        const worldRange = gridWorldRange(context.rule.range.outer, gridDpi, gridScale.parsed.multiplier);
        const detections = [...(context.responsiveDetections ?? [])].sort((left, right) => left.distance - right.distance).slice(0, GRID_MARKER_CAPACITY);
        const samples = await Promise.all(detections.map(async (detection) => {
          if (isLight(detection.emitter)) return { center: detection.emitter.position, bounds: null };
          const itemBounds = await OBR.scene.items.getItemBounds([detection.emitter.id]);
          return { center: itemBounds.center, bounds: itemBounds };
        }));
        const uniforms = shaderUniforms(effect, context.strength, scale, { x: 0, y: -1 }, resolved, { x: 0, y: -1 }, radarColorStrength);
        const desiredImages = new Map<string, { emitter: Image; layout: GridImageLayout }>();
        const showGrid = uniforms.find((uniform) => uniform.name === "showGrid"); if (showGrid) showGrid.value = effect.grid?.showGrid ? 1 : 0;
        const type = uniforms.find((uniform) => uniform.name === "gridType"); if (type) type.value = gridTypeValue(sceneGridType);
        const dpi = uniforms.find((uniform) => uniform.name === "gridDpi"); if (dpi) dpi.value = gridDpi;
        const range = uniforms.find((uniform) => uniform.name === "worldRange"); if (range) range.value = worldRange;
        const worldOrigin = uniforms.find((uniform) => uniform.name === "worldOrigin"); if (worldOrigin) worldOrigin.value = origin;
        detections.forEach((detection, index) => {
          const emitter = detection.emitter;
          const sample = samples[index];
          const markerDataA = uniforms.find((uniform) => uniform.name === `markerDataA${index}`);
          const markerDataB = uniforms.find((uniform) => uniform.name === `markerDataB${index}`);
          const markerDataC = uniforms.find((uniform) => uniform.name === `markerDataC${index}`);
          const markerDataD = uniforms.find((uniform) => uniform.name === `markerDataD${index}`);
          const markerColor = uniforms.find((uniform) => uniform.name === `markerColor${index}`);
          const position = {
            x: gridLocalValue(sample.center.x - origin.x, worldRange, localOuterRadius),
            y: gridLocalValue(sample.center.y - origin.y, worldRange, localOuterRadius),
          };
          if (markerColor) markerColor.value = resolveSignalColor(effect, detection.strength);
          const markerStrength = resolveEffectIntensity(effect, detection.strength);
          if (isLight(emitter)) {
            if (markerDataA) markerDataA.value = { x: emitter.outerAngle >= 359.999 ? 2 : 3, y: position.x, z: position.y };
            if (markerDataB) markerDataB.value = { x: 0, y: 0, z: gridLocalValue(emitter.attenuationRadius, worldRange, localOuterRadius) };
            if (markerDataC) markerDataC.value = { x: gridLocalValue(emitter.sourceRadius, worldRange, localOuterRadius), y: Math.max(0.05, emitter.falloff), z: emitter.rotation * Math.PI / 180 };
            if (markerDataD) markerDataD.value = { x: markerStrength, y: emitter.innerAngle * Math.PI / 180, z: emitter.outerAngle * Math.PI / 180 };
          } else if (sample.bounds && isImage(emitter) && showGridImages) {
            const imageLayout = gridImageLayout(effectLayout, position, {
              x: gridLocalValue(sample.bounds.width / 2, worldRange, localOuterRadius),
              y: gridLocalValue(sample.bounds.height / 2, worldRange, localOuterRadius),
            }, geometry, scale, effect.shape);
            if (imageLayout.visible) desiredImages.set(emitter.id, { emitter, layout: imageLayout });
            if (effect.grid?.imageBackgrounds) {
              const squareHalfSize = Math.max(
                gridLocalValue(sample.bounds.width / 2, worldRange, localOuterRadius),
                gridLocalValue(sample.bounds.height / 2, worldRange, localOuterRadius),
              );
              if (markerDataA) markerDataA.value = { x: 1, y: position.x, z: position.y };
              if (markerDataB) markerDataB.value = { x: squareHalfSize, y: squareHalfSize, z: 0 };
              if (markerDataD) markerDataD.value = { x: markerStrength, y: Math.PI * 2, z: Math.PI * 2 };
            }
          } else if (sample.bounds) {
            if (markerDataA) markerDataA.value = { x: 1, y: position.x, z: position.y };
            if (markerDataB) markerDataB.value = { x: gridLocalValue(sample.bounds.width / 2, worldRange, localOuterRadius), y: gridLocalValue(sample.bounds.height / 2, worldRange, localOuterRadius), z: 0 };
            if (markerDataD) markerDataD.value = { x: markerStrength, y: Math.PI * 2, z: Math.PI * 2 };
          }
        });
        await OBR.scene.local.updateItems<Effect>([existing.localItemId], (items) => { for (const item of items) item.uniforms = uniforms; });
        existing.gridImages ??= new Map();
        const staleImages = [...existing.gridImages].filter(([emitterId]) => !desiredImages.has(emitterId));
        if (staleImages.length) {
          await OBR.scene.local.deleteItems(staleImages.map(([, localId]) => localId));
          for (const [emitterId] of staleImages) existing.gridImages.delete(emitterId);
        }
        const imageZIndex = context.target!.zIndex + (effect.placement === "above" ? 2 : -1);
        const newImages: Array<{ emitterId: string; item: Image }> = [];
        const imageUpdates = new Map<string, { emitter: Image; layout: GridImageLayout; grid: Image["grid"]; scale: Image["scale"] }>();
        for (const [emitterId, image] of desiredImages) {
          const centeredGrid = { dpi: image.emitter.image.width, offset: { x: image.emitter.image.width / 2, y: image.emitter.image.height / 2 } };
          const imageScale = {
            x: image.layout.width / Math.max(1, image.emitter.image.width),
            y: image.layout.height / Math.max(1, image.emitter.image.height),
          };
          const localId = existing.gridImages.get(emitterId);
          if (localId) {
            imageUpdates.set(localId, { emitter: image.emitter, layout: image.layout, grid: centeredGrid, scale: imageScale });
          } else {
            newImages.push({ emitterId, item: buildImage(image.emitter.image, centeredGrid)
              .name(`Proximity Signal: grid image (${image.emitter.name || emitterId})`)
              .position(image.layout.center)
              .scale(imageScale)
              .rotation(image.layout.rotation)
              .zIndex(imageZIndex)
              .layer(effectLayer)
              .attachedTo(context.target!.id)
              .disableAttachmentBehavior(["SCALE", "ROTATION"])
              .locked(true)
              .disableHit(true)
              .disableAutoZIndex(true)
              .metadata({ [LOCAL_EFFECT_KEY]: { runtimeKey: context.runtimeKey, emitterId } })
              .build() });
          }
        }
        if (imageUpdates.size) {
          await OBR.scene.local.updateItems<Image>([...imageUpdates.keys()], (items) => {
            for (const item of items) {
              const update = imageUpdates.get(item.id);
              if (!update) continue;
              item.image = update.emitter.image;
              item.grid = update.grid;
              item.position = update.layout.center;
              item.scale = update.scale;
              item.rotation = update.layout.rotation;
              item.zIndex = imageZIndex;
              item.layer = effectLayer;
              item.visible = true;
            }
          });
        }
        if (newImages.length) {
          await OBR.scene.local.addItems(newImages.map(({ item }) => item));
          for (const { emitterId, item } of newImages) existing.gridImages.set(emitterId, item.id);
        }
      }
    }
    this.stopEdgeTimerIfIdle();
    this.ensureRadarTimer();
    return {
      localIds: new Map([...this.states].map(([key, state]) => [key, state.localItemId])),
      statuses: new Map([...this.states].map(([key]) => [key, "active"])),
    };
  }

  async clear(): Promise<void> {
    const ids = [...this.states.values()].flatMap((state) => this.stateItemIds(state));
    if (ids.length) await OBR.scene.local.deleteItems(ids);
    this.states.clear();
    if (this.radarTimer !== undefined) window.clearInterval(this.radarTimer);
    this.radarTimer = undefined;
    if (this.edgeTimer !== undefined) window.clearInterval(this.edgeTimer);
    this.edgeTimer = undefined;
    this.initialized = false;
  }
}

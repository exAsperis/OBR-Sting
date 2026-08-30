import type { Item, Player } from "@owlbear-rodeo/sdk";

export type Falloff = "binary" | "linear" | "smoothstep" | "logarithmic";
export type ShaderPreset = "glow" | "beam";
export type ShaderShape = "circle" | "square";
export type ShaderPlacement = "above" | "below";
export type ShaderAnimationMode = "none" | "pulse" | "flicker" | "radial-pulse";
export type StrengthLinkDirection = "min" | "max";
export type ShaderDynamicField = "intensity" | "softness" | "innerRadius" | "outerRadius" | "beamWidth" | "width" | "height" | "offsetX" | "offsetY" | "responsiveOffset" | "rotation" | "animationRate" | "animationDepth" | "waveWidth";
export interface DynamicValueRange { minimum: number; maximum: number; enabled?: boolean }
export type EffectLifecycle = "continuous" | "enter" | "exit" | "nearest-change";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type EffectTargetV1 =
  | { type: "detector" }
  | { type: "parent" }
  | { type: "carrier" }
  | { type: "detected-emitter" }
  | { type: "specific-item"; itemId: string };

export type EffectAudienceV1 =
  | { type: "everyone" }
  | { type: "gm" }
  | { type: "players" }
  | { type: "detector-owner" }
  | { type: "carrier-owner" }
  | { type: "target-owner" }
  | { type: "specific-users"; userIds: string[] };

export interface ShaderEffectDefinitionV1 {
  id: string;
  name?: string;
  type: "shader";
  enabled: boolean;
  target: EffectTargetV1;
  audience: EffectAudienceV1;
  preset: ShaderPreset;
  shape: ShaderShape;
  placement: ShaderPlacement;
  color: string;
  colorGradient?: { minColor: string };
  maxIntensity: number;
  /** Defaults to true when omitted for backward compatibility. */
  intensityStrengthLinked?: boolean;
  alwaysIncludeGm?: boolean;
  spread: number;
  spreadStrengthLink?: StrengthLinkDirection;
  dynamicRanges?: Partial<Record<ShaderDynamicField, DynamicValueRange>>;
  geometry?: {
    /** Percentage of the target half-width/height. */
    offsetX: number;
    offsetY: number;
    /** Signed percentage offset along the detected-emitter direction; positive is toward. */
    responsiveOffset?: number;
    offsetXStrengthLink?: StrengthLinkDirection;
    offsetYStrengthLink?: StrengthLinkDirection;
    /** Percentage of the normalized target radius. */
    innerRadius: number;
    outerRadius: number;
    innerRadiusStrengthLink?: StrengthLinkDirection;
    outerRadiusStrengthLink?: StrengthLinkDirection;
    /** Percentage scale of the effect's local horizontal/vertical axes. */
    width?: number;
    height?: number;
    widthStrengthLink?: StrengthLinkDirection;
    heightStrengthLink?: StrengthLinkDirection;
    /** Clockwise rotation in degrees; beams treat this as an aim offset. */
    rotation?: number;
    rotationStrengthLink?: StrengthLinkDirection;
  };
  /** Angular width in degrees for directional beam effects. */
  beamWidth?: number;
  beamWidthStrengthLink?: StrengthLinkDirection;
  animation?: {
    mode: ShaderAnimationMode;
    rate: number;
    /** Optional configurable-endpoint direction for signal-strength interpolation. */
    rateStrengthLink?: StrengthLinkDirection;
    depth: number;
    depthStrengthLink?: StrengthLinkDirection;
    radialDirection?: "outward" | "inward";
    waveWidth?: number;
    waveWidthStrengthLink?: StrengthLinkDirection;
  };
}

export interface IntegrationEffectDefinitionV1 {
  id: string;
  name?: string;
  type: "integration";
  enabled: boolean;
  lifecycle: EffectLifecycle;
  target: EffectTargetV1;
  audience: EffectAudienceV1;
  providerId: string;
  providerSchemaVersion: number;
  actionId: string;
  parameters: JsonObject;
}

export interface MechanicalFaceEffectDefinitionV1 {
  id: string;
  name?: string;
  type: "mechanical";
  enabled: boolean;
  action: "face";
  target: EffectTargetV1;
  /** Artwork-facing direction at zero item rotation, clockwise from north. */
  faceAngle: number;
  /** Pivot offset from the item's bounds center, as a percentage of half-width/height. */
  pivotX: number;
  pivotY: number;
  /** Constant angular velocity in degrees per second. */
  speed: number;
}

export interface MechanicalVisibilityEffectDefinitionV1 {
  id: string;
  name?: string;
  type: "mechanical";
  enabled: boolean;
  action: "visibility";
  target: EffectTargetV1;
  visibility: "hidden" | "shown";
  reverseOnExit: boolean;
}

export type MechanicalEffectDefinitionV1 = MechanicalFaceEffectDefinitionV1 | MechanicalVisibilityEffectDefinitionV1;

export type EffectDefinitionV1 = ShaderEffectDefinitionV1 | IntegrationEffectDefinitionV1 | MechanicalEffectDefinitionV1;

export interface DetectionRuleV1 {
  id: string;
  name?: string;
  enabled: boolean;
  signal: string;
  range: { outer: number; inner: number };
  aggregation: "nearest" | "all";
  ignoreHidden: boolean;
  falloff: Falloff;
  effects: EffectDefinitionV1[];
}

export interface EmitterMetadataV1 { version: 1; signals: string[] }
export interface DetectorMetadataV1 { version: 1; enabled: boolean; rules: DetectionRuleV1[] }

export interface AttachmentGraph {
  byId: Map<string, Item>;
  rootById: Map<string, string>;
  childrenById: Map<string, Item[]>;
}

export interface RuleEvaluation {
  detector: Item;
  rule: DetectionRuleV1;
  matchingEmitterCount: number;
  detectedEmitter: Item | null;
  distance: number | null;
  strength: number;
}

export interface RuleEvaluationSet {
  matchingEmitterCount: number;
  evaluations: RuleEvaluation[];
}

export interface RuleSnapshot {
  active: boolean;
  strength: number;
  distance: number | null;
  detectedEmitterId: string | null;
}

export type RuleTransition =
  | { type: "inactive" }
  | { type: "enter" }
  | { type: "continuous" }
  | { type: "nearest-change"; fromEmitterId: string; toEmitterId: string }
  | { type: "exit" };

export interface EffectExecutionContext extends RuleEvaluation {
  effect: EffectDefinitionV1;
  target: Item | null;
  localPlayer: Pick<Player, "id" | "role" | "connectionId">;
  party: Player[];
  graph: AttachmentGraph;
  current: RuleSnapshot;
  previous: RuleSnapshot | null;
  transition: RuleTransition;
  audienceMatch: boolean;
  /** Active detections used to derive aggregate directional shader behavior. */
  responsiveEmitters?: Item[];
}

export interface DesiredEffect extends EffectExecutionContext {
  runtimeKey: string;
}

export interface DebugEffectState {
  effectId: string;
  targetType: string;
  targetName: string | null;
  audience: string | null;
  audienceMatch: boolean;
  runtimeKey: string | null;
  localItemId: string | null;
  type: EffectDefinitionV1["type"];
  lifecycle: EffectLifecycle;
  transition: RuleTransition["type"];
  providerId?: string;
  actionId?: string;
  providerStatus?: string;
  executionStatus?: string;
}

export interface DebugRuleState {
  detectorId: string;
  detectorName: string;
  ruleId: string;
  signal: string;
  aggregation: DetectionRuleV1["aggregation"];
  range: DetectionRuleV1["range"];
  matchingEmitterCount: number;
  activeEmitterCount: number;
  detections: Array<{ emitterName: string; distance: number; strength: number }>;
  effects: DebugEffectState[];
}

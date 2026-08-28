import type { Item, Player } from "@owlbear-rodeo/sdk";

export type Falloff = "binary" | "linear" | "smoothstep";
export type ShaderPreset = "glow" | "pulse" | "flicker" | "outline";

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
  type: "shader";
  enabled: boolean;
  target: EffectTargetV1;
  audience: EffectAudienceV1;
  preset: ShaderPreset;
  color: string;
  maxIntensity: number;
  spread: number;
  animation?: { rate: number; depth: number };
}

export type EffectDefinitionV1 = ShaderEffectDefinitionV1;

export interface DetectionRuleV1 {
  id: string;
  enabled: boolean;
  signal: string;
  range: { outer: number; inner: number };
  aggregation: "nearest";
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

export interface EffectExecutionContext extends RuleEvaluation {
  effect: EffectDefinitionV1;
  target: Item | null;
  localPlayer: Pick<Player, "id" | "role">;
  party: Player[];
  graph: AttachmentGraph;
}

export interface DesiredEffect extends EffectExecutionContext {
  runtimeKey: string;
}

export interface DebugEffectState {
  effectId: string;
  targetType: string;
  targetName: string | null;
  audience: string;
  audienceMatch: boolean;
  runtimeKey: string | null;
  localItemId: string | null;
}

export interface DebugRuleState {
  detectorId: string;
  detectorName: string;
  ruleId: string;
  signal: string;
  range: DetectionRuleV1["range"];
  matchingEmitterCount: number;
  emitterName: string | null;
  distance: number | null;
  strength: number;
  effects: DebugEffectState[];
}

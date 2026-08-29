import type { ShaderEffectDefinitionV1, ShaderPreset } from "../../types";

export type ShaderGeometry = Required<NonNullable<ShaderEffectDefinitionV1["geometry"]>>;

export const DEFAULT_GEOMETRY: Record<ShaderPreset, ShaderGeometry> = {
  glow: { offsetX: 0, offsetY: 0, innerRadius: 34, outerRadius: 104, width: 100, height: 100, rotation: 0 },
  beam: { offsetX: 0, offsetY: 0, innerRadius: 0, outerRadius: 200, width: 100, height: 100, rotation: 0 },
};

export function resolveShaderGeometry(effect: ShaderEffectDefinitionV1): ShaderGeometry {
  return { ...DEFAULT_GEOMETRY[effect.preset], ...effect.geometry };
}

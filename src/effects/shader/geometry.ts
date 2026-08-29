import type { ShaderEffectDefinitionV1, ShaderPreset } from "../../types";

export type ShaderGeometry = NonNullable<ShaderEffectDefinitionV1["geometry"]>;

export const DEFAULT_GEOMETRY: Record<ShaderPreset, ShaderGeometry> = {
  glow: { offsetX: 0, offsetY: 0, innerRadius: 34, outerRadius: 104 },
  pulse: { offsetX: 0, offsetY: 0, innerRadius: 34, outerRadius: 104 },
  flicker: { offsetX: 0, offsetY: 0, innerRadius: 34, outerRadius: 104 },
  beam: { offsetX: 0, offsetY: 0, innerRadius: 0, outerRadius: 200 },
};

export function resolveShaderGeometry(effect: ShaderEffectDefinitionV1): ShaderGeometry {
  return effect.geometry ?? DEFAULT_GEOMETRY[effect.preset];
}

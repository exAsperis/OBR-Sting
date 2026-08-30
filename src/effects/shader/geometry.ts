import type { ShaderEffectDefinitionV1, ShaderPreset } from "../../types";

type GeometryDefinition = NonNullable<ShaderEffectDefinitionV1["geometry"]>;
export type ShaderGeometry = Required<Pick<GeometryDefinition, "offsetX" | "offsetY" | "responsiveOffset" | "innerRadius" | "outerRadius" | "width" | "height" | "rotation">>
  & Omit<GeometryDefinition, "offsetX" | "offsetY" | "responsiveOffset" | "innerRadius" | "outerRadius" | "width" | "height" | "rotation">;

export const DEFAULT_GEOMETRY: Record<ShaderPreset, ShaderGeometry> = {
  glow: { offsetX: 0, offsetY: 0, responsiveOffset: 0, innerRadius: 34, outerRadius: 104, width: 100, height: 100, rotation: 0 },
  beam: { offsetX: 0, offsetY: 0, responsiveOffset: 0, innerRadius: 0, outerRadius: 200, width: 100, height: 100, rotation: 0 },
};

export function resolveShaderGeometry(effect: ShaderEffectDefinitionV1): ShaderGeometry {
  return { ...DEFAULT_GEOMETRY[effect.preset], ...effect.geometry };
}

import { describe, expect, it } from "vitest";
import type { ShaderEffectDefinitionV1 } from "../../types";
import { resolveStrengthLinkedRate, resolveStrengthLinkedShaderValues, resolveStrengthLinkedValue, shaderConfigHash, shaderUniforms } from "./executor";

describe("signal-linked animation rate", () => {
  it("keeps an unlinked rate constant", () => {
    expect(resolveStrengthLinkedRate(4, undefined, 0)).toBe(4);
    expect(resolveStrengthLinkedRate(4, undefined, 0.5)).toBe(4);
    expect(resolveStrengthLinkedRate(4, undefined, 1)).toBe(4);
  });

  it("interpolates MAX from the minimum configurable rate", () => {
    expect(resolveStrengthLinkedRate(4, "max", 0)).toBe(0);
    expect(resolveStrengthLinkedRate(4, "max", 0.5)).toBe(2);
    expect(resolveStrengthLinkedRate(4, "max", 1)).toBe(4);
  });

  it("interpolates MIN from the maximum configurable rate and clamps strength", () => {
    expect(resolveStrengthLinkedRate(4, "min", -1)).toBe(10);
    expect(resolveStrengthLinkedRate(4, "min", 0.5)).toBe(7);
    expect(resolveStrengthLinkedRate(4, "min", 2)).toBe(4);
  });
});

describe("signal-linked shader geometry", () => {
  const effect: ShaderEffectDefinitionV1 = {
    id: "linked", type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
    preset: "beam", shape: "circle", placement: "above", color: "#55aaff", maxIntensity: 1,
    spread: 2, spreadStrengthLink: "max", beamWidth: 40, beamWidthStrengthLink: "min",
    geometry: {
      offsetX: 20, offsetY: -20, innerRadius: 50, outerRadius: 150, width: 100, height: 200, rotation: 30,
      offsetXStrengthLink: "max", offsetYStrengthLink: "min", innerRadiusStrengthLink: "max", outerRadiusStrengthLink: "min",
      widthStrengthLink: "max", heightStrengthLink: "min", rotationStrengthLink: "max",
    },
  };

  it("uses each field's configurable extrema at zero strength", () => {
    const resolved = resolveStrengthLinkedShaderValues(effect, 0);
    expect(resolved).toMatchObject({ spread: 0.05, beamWidth: 120, geometry: { offsetX: -100, offsetY: 100, width: 5, height: 400, rotation: -180, innerRadius: 0, outerRadius: 200 } });
  });

  it("returns configured values at full strength", () => {
    const resolved = resolveStrengthLinkedShaderValues(effect, 1);
    expect(resolved).toMatchObject({ spread: 2, beamWidth: 40, geometry: { offsetX: 20, offsetY: -20, width: 100, height: 200, rotation: 30, innerRadius: 50, outerRadius: 150 } });
  });

  it("writes the resolved beam width to the shader uniform", () => {
    const low = shaderUniforms(effect, 0, 1, { x: 1, y: 0 });
    const full = shaderUniforms(effect, 1, 1, { x: 1, y: 0 });
    expect(low.find((uniform) => uniform.name === "beamWidth")?.value).toBe(120);
    expect(full.find((uniform) => uniform.name === "beamWidth")?.value).toBe(40);
  });

  it("invalidates runtime configuration when root-level links change", () => {
    expect(shaderConfigHash(effect)).not.toBe(shaderConfigHash({ ...effect, beamWidthStrengthLink: undefined }));
    expect(shaderConfigHash(effect)).not.toBe(shaderConfigHash({ ...effect, spreadStrengthLink: undefined }));
  });

  it("keeps linked beam radii ordered", () => {
    const conflicting = { ...effect, geometry: { ...effect.geometry!, innerRadiusStrengthLink: "min" as const, outerRadiusStrengthLink: "max" as const } };
    const geometry = resolveStrengthLinkedShaderValues(conflicting, 0).geometry;
    expect(geometry.outerRadius).toBeGreaterThanOrEqual(geometry.innerRadius + 1);
    expect(geometry.outerRadius).toBeLessThanOrEqual(200);
  });
});

describe("bounded signal-linked values", () => {
  it("interpolates depth across its 0–1 range", () => {
    expect(resolveStrengthLinkedValue(0.6, "max", 0, 0, 1)).toBe(0);
    expect(resolveStrengthLinkedValue(0.6, "max", 0.5, 0, 1)).toBeCloseTo(0.3);
    expect(resolveStrengthLinkedValue(0.6, "min", 0.5, 0, 1)).toBeCloseTo(0.8);
    expect(resolveStrengthLinkedValue(0.6, "min", 1, 0, 1)).toBeCloseTo(0.6);
  });

  it("interpolates wave width across its 0.05–1 range", () => {
    expect(resolveStrengthLinkedValue(0.25, "max", 0, 0.05, 1)).toBe(0.05);
    expect(resolveStrengthLinkedValue(0.25, "max", 0.5, 0.05, 1)).toBeCloseTo(0.15);
    expect(resolveStrengthLinkedValue(0.25, "min", 0.5, 0.05, 1)).toBeCloseTo(0.625);
    expect(resolveStrengthLinkedValue(0.25, "min", 1, 0.05, 1)).toBeCloseTo(0.25);
  });
});

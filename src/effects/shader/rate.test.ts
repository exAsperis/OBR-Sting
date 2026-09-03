import { describe, expect, it } from "vitest";
import type { ShaderEffectDefinitionV1 } from "../../types";
import { averageDetectionDirections, calibrateEdgeImageScale, circularPhaseCrossed, edgeFootprintSize, edgeImageScale, gridImageLayout, gridLocalValue, gridTypeValue, gridWorldRange, radarDistancePosition, radarEchoSize, radarSweepIsAnimated, resolveEdgeSize, resolveEffectIntensity, resolveRadarEchoSize, resolveRadarFadeDuration, resolveSignalColor, resolveStrengthLinkedRate, resolveStrengthLinkedShaderValues, resolveStrengthLinkedValue, shaderConfigHash, shaderUniforms } from "./executor";

describe("radar helpers", () => {
  const radar: ShaderEffectDefinitionV1 = {
    id: "radar", type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
    preset: "radar", shape: "square", placement: "above", color: "#00ff88", maxIntensity: 0.5, spread: 1,
    radar: { echoStyle: "blob", echoSize: 100, distanceScale: "logarithmic", decoration: "m314", sweepTrail: 100, brightness: 0.4, sweepType: "angular", sweepDirection: "counterclockwise", echoFadeDuration: 5 },
    dynamicRanges: { echoFadeDuration: { minimum: 2, maximum: 8 }, radarBrightness: { minimum: 0.2, maximum: 0.8 }, radarSweepTrail: { minimum: 20, maximum: 80 }, radarEchoSize: { minimum: 50, maximum: 200 } },
  };

  it("maps zero and maximum detection distance to the configured radii", () => {
    expect(radarDistancePosition(0, 60, 0.2, 1)).toBe(0.2);
    expect(radarDistancePosition(30, 60, 0.2, 1)).toBeCloseTo(0.6);
    expect(radarDistancePosition(60, 60, 0.2, 1)).toBe(1);
    expect(radarDistancePosition(30, 60, 0.2, 1, "logarithmic")).toBeGreaterThan(0.6);
  });

  it("detects ordinary and wrapped sweep crossings", () => {
    expect(circularPhaseCrossed(0.1, 0.4, 0.25)).toBe(true);
    expect(circularPhaseCrossed(0.9, 0.1, 0.98)).toBe(true);
    expect(circularPhaseCrossed(0.9, 0.1, 0.5)).toBe(false);
  });

  it("scales echo footprints with detected item area and clamps extremes", () => {
    expect(radarEchoSize(100, 100)).toBeCloseTo(0.028);
    expect(radarEchoSize(400, 100)).toBeCloseTo(0.056);
    expect(radarEchoSize(0.01, 10000)).toBeCloseTo(0.012);
    expect(radarEchoSize(1000000, 1)).toBeCloseTo(0.12);
    expect(radarEchoSize(100, 100, 200)).toBeCloseTo(0.056);
    expect(resolveRadarEchoSize(radar, 0, 100, 100)).toBeCloseTo(0.014);
    expect(resolveRadarEchoSize(radar, 1, 100, 100)).toBeCloseTo(0.056);
  });

  it("resolves dynamic fade duration and radar uniforms", () => {
    expect(resolveRadarFadeDuration(radar, 0.5)).toBe(5);
    const uniforms = shaderUniforms(radar, 1, 1, { x: 0, y: -1 });
    expect(uniforms.find((entry) => entry.name === "echoStyle")?.value).toBe(1);
    expect(uniforms.find((entry) => entry.name === "echoPosition31")).toBeDefined();
    expect(uniforms.find((entry) => entry.name === "echoSize31")?.value).toBe(0.028);
    expect(uniforms.find((entry) => entry.name === "decorationMode")?.value).toBe(1);
    expect(uniforms.find((entry) => entry.name === "trailEnabled")?.value).toBe(0.8);
    expect(uniforms.find((entry) => entry.name === "brightness")?.value).toBe(0.8);
    const modernUniforms = shaderUniforms({ ...radar, radar: { ...radar.radar!, decoration: "modern" } }, 1, 1, { x: 0, y: -1 });
    expect(modernUniforms.find((entry) => entry.name === "decorationMode")?.value).toBe(2);
    const arcaneUniforms = shaderUniforms({ ...radar, radar: { ...radar.radar!, decoration: "arcane" } }, 1, 1, { x: 0, y: -1 });
    expect(arcaneUniforms.find((entry) => entry.name === "decorationMode")?.value).toBe(3);
    const staticUniforms = shaderUniforms({ ...radar, radar: { ...radar.radar!, sweepType: "none" } }, 1, 1, { x: 0, y: -1 });
    expect(staticUniforms.find((entry) => entry.name === "sweepType")?.value).toBe(-1);
    const runeUniforms = shaderUniforms({ ...radar, radar: { ...radar.radar!, echoStyle: "rune" } }, 1, 1, { x: 0, y: -1 });
    expect(runeUniforms.find((entry) => entry.name === "echoStyle")?.value).toBe(2);
    expect(runeUniforms.find((entry) => entry.name === "echoRune0")?.value).toBe(0);
    expect(runeUniforms.find((entry) => entry.name === "echoRune6")?.value).toBe(6);
    expect(runeUniforms.find((entry) => entry.name === "echoRune11")?.value).toBe(1);
    const gradientRadar = { ...radar, colorGradient: { minColor: "#000000" } };
    const strongestColorUniforms = shaderUniforms(gradientRadar, 0.2, 1, { x: 0, y: -1 }, undefined, undefined, 0.8);
    expect(strongestColorUniforms.find((entry) => entry.name === "signalColor")?.value).toEqual(resolveSignalColor(gradientRadar, 0.8));
    expect(strongestColorUniforms.find((entry) => entry.name === "echoColor31")).toBeDefined();
  });

  it("excludes static radar mode from all sweep and fade ticking", () => {
    expect(radarSweepIsAnimated({ ...radar, radar: { ...radar.radar!, sweepType: "none" } })).toBe(false);
    expect(radarSweepIsAnimated(radar)).toBe(true);
  });
});

describe("edge indicator dynamic size", () => {
  const edge: ShaderEffectDefinitionV1 = {
    id: "edge", type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
    preset: "edge", shape: "circle", placement: "above", color: "#ffffff", maxIntensity: 1, spread: 1,
    edge: { appearance: "triangle", size: 64, inset: 16 }, dynamicRanges: { indicatorSize: { minimum: 24, maximum: 120 } },
  };
  it("resolves independently from detection strength", () => {
    expect(resolveEdgeSize(edge, 0)).toBe(24);
    expect(resolveEdgeSize(edge, 0.5)).toBe(72);
    expect(resolveEdgeSize(edge, 1)).toBe(120);
  });
  it("places every image bounding-box corner on the circle", () => {
    const scale = edgeImageScale({ width: 120, height: 90 }, 100);
    expect(Math.hypot(120 * scale / 2, 90 * scale / 2)).toBeCloseTo(50);
    expect(calibrateEdgeImageScale(scale, 100, 40)).toBeCloseTo(scale * 2.5);
  });
  it("allows clearance for the single exposed tangent-square vertex", () => {
    expect(edgeFootprintSize({ ...edge, edge: { ...edge.edge!, appearance: "image" } }, 0.5)).toBeCloseTo(72 * Math.SQRT2);
    expect(edgeFootprintSize({ ...edge, edge: { ...edge.edge!, appearance: "disk" } }, 0.5)).toBe(72);
  });
});

describe("grid visualization helpers", () => {
  it("maps raw world coordinates and sizes uniformly to the configured outer radius", () => {
    expect(gridWorldRange(60, 100, 5)).toBe(1200);
    expect(gridLocalValue(600, 1200, 0.8)).toBeCloseTo(0.4);
    expect(gridLocalValue(200, 1200, 0.8)).toBeCloseTo(0.133333);
  });

  it("encodes every Owlbear scene grid type", () => {
    expect(["SQUARE", "HEX_VERTICAL", "HEX_HORIZONTAL", "DIMETRIC", "ISOMETRIC"].map((type) => gridTypeValue(type as Parameters<typeof gridTypeValue>[0]))).toEqual([0, 1, 2, 3, 4]);
  });

  it("projects image bounds through Grid dimensions, offsets, and rotation", () => {
    const projected = gridImageLayout(
      { width: 400, height: 200, position: { x: 100, y: 50 } },
      { x: 0.25, y: 0 },
      { x: 0.1, y: 0.05 },
      { offsetX: 10, offsetY: -20, responsiveOffset: 0, innerRadius: 0, outerRadius: 100, width: 200, height: 50, rotation: 90 },
      1,
      "circle",
    );
    expect(projected.center.x).toBeCloseTo(320);
    expect(projected.center.y).toBeCloseTo(180);
    expect(projected.width).toBeCloseTo(160);
    expect(projected.height).toBeCloseTo(10);
    expect(projected.rotation).toBe(90);
    expect(projected.visible).toBe(true);
  });

  it("uses center-only circle and square clipping for Grid images", () => {
    const geometry = { offsetX: 0, offsetY: 0, responsiveOffset: 0, innerRadius: 25, outerRadius: 100, width: 100, height: 100, rotation: 0 };
    const layout = { width: 100, height: 100, position: { x: 0, y: 0 } };
    expect(gridImageLayout(layout, { x: 0.2, y: 0 }, { x: 1, y: 1 }, geometry, 1, "circle").visible).toBe(false);
    expect(gridImageLayout(layout, { x: 0.8, y: 0.8 }, { x: 1, y: 1 }, geometry, 1, "circle").visible).toBe(false);
    expect(gridImageLayout(layout, { x: 0.8, y: 0.8 }, { x: 1, y: 1 }, geometry, 1, "square").visible).toBe(true);
  });

  it("includes Grid image visibility in shader configuration hashing", () => {
    const base: ShaderEffectDefinitionV1 = { id: "grid", type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" }, preset: "grid", shape: "circle", placement: "above", color: "#00ff88", maxIntensity: 1, spread: 1, grid: { showGrid: false, showImages: false, imageBackgrounds: false } };
    expect(shaderConfigHash(base)).not.toBe(shaderConfigHash({ ...base, grid: { showGrid: false, showImages: true, imageBackgrounds: false } }));
    expect(shaderConfigHash(base)).not.toBe(shaderConfigHash({ ...base, grid: { showGrid: false, showImages: false, imageBackgrounds: true } }));
  });
});

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
    expect(resolved).toMatchObject({ spread: 0, beamWidth: 120, geometry: { offsetX: -100, offsetY: 100, width: 5, height: 400, rotation: -180, innerRadius: 0, outerRadius: 200 } });
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

  it("defaults origin width to zero and resolves a dynamic origin width", () => {
    expect(resolveStrengthLinkedShaderValues(effect, 0.5).beamOriginWidth).toBe(0);
    const tapered = { ...effect, beamOriginWidth: 100, dynamicRanges: { beamOriginWidth: { minimum: 20, maximum: 100 } } };
    expect(resolveStrengthLinkedShaderValues(tapered, 0).beamOriginWidth).toBe(20);
    expect(resolveStrengthLinkedShaderValues(tapered, 0.5).beamOriginWidth).toBe(60);
    expect(resolveStrengthLinkedShaderValues(tapered, 1).beamOriginWidth).toBe(100);
    const uniforms = shaderUniforms(tapered, 1, 2, { x: 1, y: 0 });
    expect(uniforms.find((uniform) => uniform.name === "beamOriginWidth")?.value).toBe(0.5);
    const targetSizedUniforms = shaderUniforms(tapered, 1, 1, { x: 1, y: 0 });
    expect(targetSizedUniforms.find((uniform) => uniform.name === "beamOriginWidth")?.value).toBe(1);
  });

  it("invalidates runtime configuration when root-level links change", () => {
    expect(shaderConfigHash(effect)).not.toBe(shaderConfigHash({ ...effect, beamWidthStrengthLink: undefined }));
    expect(shaderConfigHash(effect)).not.toBe(shaderConfigHash({ ...effect, spreadStrengthLink: undefined }));
    expect(shaderConfigHash(effect)).not.toBe(shaderConfigHash({ ...effect, beamOriginWidth: 50 }));
    expect(shaderConfigHash(effect)).not.toBe(shaderConfigHash({ ...effect, dynamicRanges: { beamOriginWidth: { minimum: 0, maximum: 100 } } }));
  });

  it("keeps linked beam radii ordered", () => {
    const conflicting = { ...effect, geometry: { ...effect.geometry!, innerRadiusStrengthLink: "min" as const, outerRadiusStrengthLink: "max" as const } };
    const geometry = resolveStrengthLinkedShaderValues(conflicting, 0).geometry;
    expect(geometry.outerRadius).toBeGreaterThanOrEqual(geometry.innerRadius + 1);
    expect(geometry.outerRadius).toBeLessThanOrEqual(200);
  });

  it("interpolates responsive offset between dynamic endpoints", () => {
    const responsive = { ...effect, preset: "glow" as const, geometry: { ...effect.geometry!, responsiveOffset: 0 }, dynamicRanges: { responsiveOffset: { minimum: -20, maximum: 60 } } };
    expect(resolveStrengthLinkedShaderValues(responsive, 0).geometry.responsiveOffset).toBe(-20);
    expect(resolveStrengthLinkedShaderValues(responsive, 0.5).geometry.responsiveOffset).toBe(20);
    expect(resolveStrengthLinkedShaderValues(responsive, 1).geometry.responsiveOffset).toBe(60);
    const crossed = { ...responsive, dynamicRanges: { responsiveOffset: { minimum: 60, maximum: -20 } } };
    expect(resolveStrengthLinkedShaderValues(crossed, 0).geometry.responsiveOffset).toBe(60);
    expect(resolveStrengthLinkedShaderValues(crossed, 1).geometry.responsiveOffset).toBe(-20);
    const disabled = { ...responsive, geometry: { ...responsive.geometry, responsiveOffset: 35 }, dynamicRanges: { responsiveOffset: { minimum: -20, maximum: 60, enabled: false } } };
    expect(resolveStrengthLinkedShaderValues(disabled, 0).geometry.responsiveOffset).toBe(35);
    expect(resolveStrengthLinkedShaderValues(disabled, 1).geometry.responsiveOffset).toBe(35);
  });

  it("compounds responsive and fixed offsets in the glow center uniform", () => {
    const responsive = { ...effect, preset: "glow" as const, geometry: { ...effect.geometry!, offsetX: 10, offsetY: -5, responsiveOffset: 40 } };
    const center = shaderUniforms(responsive, 1, 2, { x: 1, y: 0 }, undefined, { x: 0.6, y: 0.8 })
      .find((uniform) => uniform.name === "centerOffset")?.value;
    expect(center).toEqual({ x: 0.17, y: 0.135 });
  });
});

describe("responsive detection direction", () => {
  it("averages unit direction vectors without combining signal strength", () => {
    const direction = averageDetectionDirections({ x: 0, y: 0 }, [{ x: 10, y: 0 }, { x: 0, y: 4 }]);
    expect(direction).toEqual({ x: 0.5, y: 0.5 });
  });

  it("cancels opposing detections", () => {
    expect(averageDetectionDirections({ x: 0, y: 0 }, [{ x: 10, y: 0 }, { x: -2, y: 0 }])).toEqual({ x: 0, y: 0 });
  });

  it("keeps aligned detections at full directional magnitude", () => {
    expect(averageDetectionDirections({ x: 0, y: 0 }, [{ x: 2, y: 0 }, { x: 20, y: 0 }])).toEqual({ x: 1, y: 0 });
  });
});

describe("generic shader dynamic ranges", () => {
  const base: ShaderEffectDefinitionV1 = {
    id: "dynamic", type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
    preset: "glow", shape: "circle", placement: "above", color: "#55aaff", maxIntensity: 1, spread: 1,
    geometry: { offsetX: 0, offsetY: 0, innerRadius: 34, outerRadius: 118 },
  };
  it("interpolates newly dynamic glow radii and preserves their ordering", () => {
    const dynamic = {
      ...base,
      preset: "glow" as const,
      dynamicRanges: { innerRadius: { minimum: 10, maximum: 90 }, outerRadius: { minimum: 150, maximum: 70 } },
    };
    expect(resolveStrengthLinkedShaderValues(dynamic, 0).geometry).toMatchObject({ innerRadius: 10, outerRadius: 150 });
    const full = resolveStrengthLinkedShaderValues(dynamic, 1).geometry;
    expect(full.outerRadius).toBe(full.innerRadius + 1);
  });

  it("interpolates intensity, softness, and animation fields", () => {
    const dynamic = {
      ...base,
      animation: { mode: "pulse" as const, rate: 1, depth: 0.2 },
      dynamicRanges: {
        intensity: { minimum: 0.5, maximum: 1.5 }, softness: { minimum: 0.5, maximum: 2.5 },
        animationRate: { minimum: 2, maximum: 6 }, animationDepth: { minimum: 0.1, maximum: 0.9 },
      },
    };
    expect(resolveEffectIntensity(dynamic, 0.5)).toBe(1);
    expect(resolveStrengthLinkedShaderValues(dynamic, 0.5).spread).toBe(1.5);
    const uniforms = shaderUniforms(dynamic, 0.5, 1, { x: 1, y: 0 });
    expect(uniforms.find((entry) => entry.name === "rate")?.value).toBe(4);
    expect(uniforms.find((entry) => entry.name === "depth")?.value).toBe(0.5);
  });
});

describe("segmented glow uniforms", () => {
  const glow: ShaderEffectDefinitionV1 = {
    id: "segments", type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
    preset: "glow", shape: "circle", placement: "above", color: "#55aaff", maxIntensity: 1, spread: 1,
    glow: { segments: 12, segmentAlignment: "boundary" },
  };

  it("passes segment configuration and the per-detection direction", () => {
    const uniforms = shaderUniforms(glow, 0.5, 1, { x: 0.6, y: -0.8 });
    expect(uniforms.find((uniform) => uniform.name === "segmentCount")?.value).toBe(12);
    expect(uniforms.find((uniform) => uniform.name === "segmentAlignment")?.value).toBe(1);
    expect(uniforms.find((uniform) => uniform.name === "signalDirection")?.value).toEqual({ x: 0.6, y: -0.8 });
  });

  it("defaults to the unmasked single centered segment", () => {
    const uniforms = shaderUniforms({ ...glow, glow: undefined }, 1, 1, { x: 0, y: -1 });
    expect(uniforms.find((uniform) => uniform.name === "segmentCount")?.value).toBe(1);
    expect(uniforms.find((uniform) => uniform.name === "segmentAlignment")?.value).toBe(0);
  });

  it("includes Glow segmentation in configuration hashing", () => {
    expect(shaderConfigHash(glow)).not.toBe(shaderConfigHash({ ...glow, glow: { ...glow.glow!, segments: 11 } }));
    expect(shaderConfigHash(glow)).not.toBe(shaderConfigHash({ ...glow, glow: { ...glow.glow!, segmentAlignment: "center" } }));
  });
});

describe("signal-linked color and intensity", () => {
  const effect: ShaderEffectDefinitionV1 = {
    id: "color", type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
    preset: "glow", shape: "circle", placement: "above", color: "#ffffff", colorGradient: { minColor: "#000000" }, maxIntensity: 1.5, spread: 1,
  };

  it("interpolates the gradient endpoints in RGB", () => {
    expect(resolveSignalColor(effect, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(resolveSignalColor(effect, 0.5)).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
    expect(resolveSignalColor(effect, 1)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("defaults intensity linking on and supports static intensity", () => {
    expect(resolveEffectIntensity(effect, 0.4)).toBeCloseTo(0.6);
    expect(resolveEffectIntensity({ ...effect, intensityStrengthLinked: false }, 0.4)).toBe(1.5);
  });
});

describe("bounded signal-linked values", () => {
  it("interpolates depth across its 0–1 range", () => {
    expect(resolveStrengthLinkedValue(0.6, "max", 0, 0, 1)).toBe(0);
    expect(resolveStrengthLinkedValue(0.6, "max", 0.5, 0, 1)).toBeCloseTo(0.3);
    expect(resolveStrengthLinkedValue(0.6, "min", 0.5, 0, 1)).toBeCloseTo(0.8);
    expect(resolveStrengthLinkedValue(0.6, "min", 1, 0, 1)).toBeCloseTo(0.6);
  });

  it("interpolates wave width across its 0–1 range", () => {
    expect(resolveStrengthLinkedValue(0.25, "max", 0, 0, 1)).toBe(0);
    expect(resolveStrengthLinkedValue(0.25, "max", 0.5, 0, 1)).toBeCloseTo(0.125);
    expect(resolveStrengthLinkedValue(0.25, "min", 0.5, 0, 1)).toBeCloseTo(0.625);
    expect(resolveStrengthLinkedValue(0.25, "min", 1, 0, 1)).toBeCloseTo(0.25);
  });
});

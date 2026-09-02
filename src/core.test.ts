import type { Item, Light } from "@owlbear-rodeo/sdk";
import { describe, expect, it } from "vitest";
import { EMITTER_KEY } from "./constants";
import { buildRuntimeEffectKey } from "./effects/runtimeKey";
import { parseDetectorMetadata, parseEffectDefinition, parseEmitterMetadata } from "./metadata/parse";
import { calculateStrength } from "./proximity/strength";
import { evaluateRule, indexEmittersBySignal, matchesRuleText, selectRuleEvaluations } from "./proximity/evaluate";
import { getSceneDistance, toSceneUnits } from "./proximity/distance";
import { buildAttachmentGraph, isSameAttachmentFamily, resolveCarrier, resolveParent } from "./scene/attachments";
import { isAudienceMember, isShaderAudienceMember, resolveEffectTarget } from "./scene/resolve";
import { normalizeSignal, normalizeSignals, parseEmitterSignal } from "./signals/normalize";
import { DEFAULT_SCENE_SETTINGS, parseSceneSettings } from "./settings";
import type { DetectionRuleV1, EffectAudienceV1, EffectDefinitionV1, ShaderEffectDefinitionV1 } from "./types";

const item = (id: string, attachedTo?: string, owner = `${id}-owner`): Item => ({
  id, type: "IMAGE", name: id, visible: true, locked: false, createdUserId: owner,
  zIndex: 0, lastModified: "", lastModifiedUserId: owner, position: { x: 0, y: 0 },
  rotation: 0, scale: { x: 1, y: 1 }, metadata: {}, layer: attachedTo ? "ATTACHMENT" : "CHARACTER",
  ...(attachedTo ? { attachedTo } : {}),
});

const effect = (id = "effect-1"): ShaderEffectDefinitionV1 => ({
  id, type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
  preset: "glow", shape: "circle", placement: "above", color: "#55aaff", maxIntensity: 1, spread: 1,
});

const rule = (id: string, effects: EffectDefinitionV1[] = []): DetectionRuleV1 => ({
  id, enabled: true, signal: "orc", matchType: "exact", excludeLayers: [], range: { outer: 60, inner: 5 }, aggregation: "nearest", ignoreHidden: false, falloff: "smoothstep", effects,
});

describe("signal normalization", () => {
  it.each([[" Orc ", "orc"], ["ORC", "orc"], ["Red   Hand", "red-hand"], [" faction:RED_hand ", "faction:red_hand"]])("normalizes %s", (input, expected) => expect(normalizeSignal(input)).toBe(expected));
  it("removes duplicates and empty signals", () => expect(normalizeSignals([" Orc ", "ORC", " "])).toEqual(["orc"]));
  it("parses normalized emitter metadata and defaults legacy emitters to enabled", () => expect(parseEmitterMetadata({ version: 1, signals: [" Orc ", "ORC"] })).toEqual({ version: 1, enabled: true, signals: ["orc"] }));
  it.each([
    ["light", { signal: "light", tag: "light" }],
    [" LIGHT [ 20 ] ", { signal: "light", range: 20, tag: "light[20]" }],
    ["light[2.50]", { signal: "light", range: 2.5, tag: "light[2.5]" }],
    ["light[.5]", { signal: "light", range: 0.5, tag: "light[0.5]" }],
  ])("parses emitter signal %s", (input, expected) => expect(parseEmitterSignal(input)).toEqual(expected));
  it.each(["light[0]", "light[-1]", "light[]", "light[abc]", "light[Infinity]", "light[20", "light]20["])("rejects invalid emitter range %s", (input) => expect(parseEmitterSignal(input)).toBeNull());
  it("preserves distinct ranged variants and removes exact canonical duplicates", () => {
    expect(normalizeSignals(["light[20]", "LIGHT[20.0]", "light[60]", "light"])).toEqual(["light[20]", "light[60]", "light"]);
  });
  it("round trips canonical ranged emitter metadata", () => {
    expect(parseEmitterMetadata({ version: 1, enabled: false, signals: [" LIGHT [ 20.0 ] ", "light[60]"] })).toEqual({ version: 1, enabled: false, signals: ["light[20]", "light[60]"] });
  });
  it("rejects invalid emitter enabled values", () => expect(parseEmitterMetadata({ version: 1, enabled: "yes", signals: ["light"] })).toBeNull());
});

describe("rule text matching", () => {
  it("matches exact text after trimming and case normalization", () => expect(matchesRuleText(" Red Dragon ", "red dragon", "exact")).toBe(true));
  it.each([
    ["Red Dragon", "red*", true],
    ["Red Dragon", "red ??????", true],
    ["Red Dragon", "blue*", false],
  ])("matches wildcard text %#", (value, pattern, expected) => expect(matchesRuleText(value, pattern, "wildcard")).toBe(expected));
  it("matches case-insensitive regex and safely rejects invalid regex", () => {
    expect(matchesRuleText("Somewyn", "^somew(y|i)n$", "regex")).toBe(true);
    expect(matchesRuleText("Somewyn", "[", "regex")).toBe(false);
  });
});

describe("strength", () => {
  it("converts grid cells to the displayed scene unit", () => {
    expect(toSceneUnits(14, 5)).toBe(70);
    expect(toSceneUnits(3, 1.5)).toBe(4.5);
  });
  it("handles outer and inner boundaries", () => {
    expect(calculateStrength(61, 60, 5, "linear")).toBe(0);
    expect(calculateStrength(60, 60, 5, "linear")).toBe(0);
    expect(calculateStrength(5, 60, 5, "linear")).toBe(1);
    expect(calculateStrength(2, 60, 5, "linear")).toBe(0);
  });
  it.each(["linear", "smoothstep", "logarithmic"] as const)("uses the inner value as an inclusive lower bound with %s falloff", (falloff) => {
    expect(calculateStrength(4.99, 60, 5, falloff)).toBe(0);
    expect(calculateStrength(5, 60, 5, falloff)).toBe(1);
    expect(calculateStrength(32.5, 60, 5, falloff)).toBeGreaterThan(0);
    expect(calculateStrength(32.5, 60, 5, falloff)).toBeLessThan(1);
    expect(calculateStrength(60, 60, 5, falloff)).toBe(0);
  });
  it("calculates linear and smoothstep midpoints", () => {
    expect(calculateStrength(32.5, 60, 5, "linear")).toBeCloseTo(0.5);
    expect(calculateStrength(32.5, 60, 5, "smoothstep")).toBeCloseTo(0.5);
  });
  it("calculates binary falloff", () => {
    expect(calculateStrength(4.99, 60, 5, "binary")).toBe(0);
    expect(calculateStrength(5, 60, 5, "binary")).toBe(1);
    expect(calculateStrength(60, 60, 5, "binary")).toBe(1);
    expect(calculateStrength(60.01, 60, 5, "binary")).toBe(0);
  });
});

describe("versioned detector parsing", () => {
  it("allows duplicate signals when IDs differ", () => {
    const parsed = parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("a"), rule("b")] });
    expect(parsed?.rules).toHaveLength(2);
  });
  it.each([0, 1, 3])("parses %i effects", (count) => {
    const effects = Array.from({ length: count }, (_, index) => effect(`effect-${index}`));
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("rule", effects)] })?.rules[0].effects).toHaveLength(count);
  });
  it("rejects invalid ranges and duplicate stable IDs", () => {
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("a"), range: { inner: 10, outer: 10 } }] })).not.toBeNull();
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("a"), range: { inner: 11, outer: 10 } }] })).toBeNull();
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("a"), rule("a")] })).toBeNull();
  });
  it("calculates logarithmic falloff with a steep initial drop and a long tail", () => {
    expect(calculateStrength(5, 60, 5, "logarithmic")).toBe(1);
    expect(calculateStrength(60, 60, 5, "logarithmic")).toBe(0);
    expect(calculateStrength(32.5, 60, 5, "logarithmic")).toBeCloseTo(1 - Math.log(5.5) / Math.log(10));
    expect(calculateStrength(18.75, 60, 5, "logarithmic")).toBeGreaterThan(calculateStrength(46.25, 60, 5, "logarithmic"));
  });
  it("calculates straight-line distance from scene pixels and grid DPI", async () => {
    await expect(getSceneDistance({ x: 0, y: 0 }, { x: 300, y: 400 }, 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean")).resolves.toBe(25);
  });
  it("supports every square-grid override", async () => {
    const grid = { dpi: 100, type: "SQUARE" as const, measurement: "CHEBYSHEV" as const };
    await expect(getSceneDistance({ x: 0, y: 0 }, { x: 300, y: 200 }, 5, grid, "chessboard")).resolves.toBe(15);
    await expect(getSceneDistance({ x: 0, y: 0 }, { x: 300, y: 200 }, 5, grid, "alternating")).resolves.toBe(20);
    await expect(getSceneDistance({ x: 0, y: 0 }, { x: 300, y: 200 }, 5, grid, "manhattan")).resolves.toBe(25);
  });
  it("counts both hex orientations and projected isometric cells", async () => {
    await expect(getSceneDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 5, { dpi: 100, type: "HEX_VERTICAL", measurement: "CHEBYSHEV" }, "hexagon")).resolves.toBe(5);
    await expect(getSceneDistance({ x: 0, y: 0 }, { x: 0, y: 100 }, 5, { dpi: 100, type: "HEX_HORIZONTAL", measurement: "CHEBYSHEV" }, "hexagon")).resolves.toBe(5);
    await expect(getSceneDistance({ x: 0, y: 0 }, { x: Math.sqrt(3) * 50, y: 50 }, 5, { dpi: 100, type: "ISOMETRIC", measurement: "CHEBYSHEV" }, "chessboard")).resolves.toBe(5);
  });
  it("accepts closest and all aggregation modes", () => {
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("closest")] })?.rules[0].aggregation).toBe("nearest");
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("all"), aggregation: "all" }] })?.rules[0].aggregation).toBe("all");
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("bad"), aggregation: "count" }] })).toBeNull();
  });
  it("defaults legacy rules to detecting hidden emitters and validates ignoreHidden", () => {
    const { ignoreHidden: _ignoreHidden, ...legacy } = rule("legacy");
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [legacy] })?.rules[0].ignoreHidden).toBe(false);
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("ignore"), ignoreHidden: true }] })?.rules[0].ignoreHidden).toBe(true);
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("bad"), ignoreHidden: "yes" }] })).toBeNull();
  });
  it.each(["item-name", "item-label"] as const)("parses the %s source type", (type) => {
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule(type), source: { type } }] })?.rules[0].source).toEqual({ type });
  });
  it("defaults advanced rule settings and validates configured layers", () => {
    const parsed = parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("advanced")] })?.rules[0];
    expect(parsed).toMatchObject({ matchType: "exact", excludeLayers: [] });
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("layers"), matchType: "wildcard", excludeLayers: ["CHARACTER", "PROP"] }] })?.rules[0])
      .toMatchObject({ matchType: "wildcard", excludeLayers: ["CHARACTER", "PROP"] });
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("bad-layer"), excludeLayers: ["UNKNOWN"] }] })).toBeNull();
  });
  it("parses valid shader geometry and rejects inverted radii", () => {
    const configured = { ...effect(), geometry: { offsetX: 20, offsetY: -15, innerRadius: 30, outerRadius: 120 } };
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("a", [configured])] })?.rules[0].effects[0]).toMatchObject(configured);
    const invalid = { ...effect(), geometry: { offsetX: 0, offsetY: 0, innerRadius: 80, outerRadius: 40 } };
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("a", [invalid])] })).toBeNull();
  });

  it("parses shader shapes, defaults legacy effects to circle, and rejects unknown shapes", () => {
    expect(parseEffectDefinition({ ...effect(), shape: "square" })).toMatchObject({ type: "shader", shape: "square" });
    const { shape: _shape, ...legacy } = effect();
    expect(parseEffectDefinition(legacy)).toMatchObject({ type: "shader", shape: "circle" });
    expect(parseEffectDefinition({ ...effect(), shape: "triangle" })).toBeNull();
  });

  it("parses shader placement, defaults legacy effects above, and rejects unknown placement", () => {
    expect(parseEffectDefinition({ ...effect(), placement: "below" })).toMatchObject({ type: "shader", placement: "below" });
    const { placement: _placement, ...legacy } = effect();
    expect(parseEffectDefinition(legacy)).toMatchObject({ type: "shader", placement: "above" });
    expect(parseEffectDefinition({ ...effect(), placement: "inside" })).toBeNull();
  });

  it("migrates legacy outlines to crisp glows", () => {
    const parsed = parseEffectDefinition({ ...effect(), preset: "outline", maxIntensity: 1, spread: 1.25 });
    expect(parsed).toMatchObject({ preset: "glow", spread: 0.15 });
    expect(parsed?.type === "shader" ? parsed.maxIntensity : 0).toBeCloseTo(0.95 / 0.62);
  });

  it.each(["pulse", "flicker"] as const)("migrates legacy %s presets to glow animations", (preset) => {
    const parsed = parseEffectDefinition({ ...effect(), preset, animation: { rate: 2, depth: 0.6 } });
    expect(parsed).toMatchObject({ preset: "glow", animation: { mode: preset, rate: 2, depth: 0.6 } });
  });

  it("parses radial pulse direction and wave width", () => {
    const radial = { ...effect(), animation: { mode: "radial-pulse", rate: 1.5, depth: 0.8, radialDirection: "inward", waveWidth: 0.3 } };
    expect(parseEffectDefinition(radial)).toMatchObject(radial);
    expect(parseEffectDefinition({ ...radial, animation: { ...radial.animation, waveWidth: 0 } })).toMatchObject({ animation: { waveWidth: 0 } });
    expect(parseEffectDefinition({ ...radial, animation: { ...radial.animation, waveWidth: 2 } })).toBeNull();
  });
  it("parses radar defaults, configuration, and dynamic echo fade", () => {
    expect(parseEffectDefinition({ ...effect(), preset: "radar" })).toMatchObject({ preset: "radar", radar: { echoStyle: "circle", echoSize: 100, distanceScale: "linear", decoration: "none", sweepTrail: 0, brightness: 0.35, sweepType: "none", sweepDirection: "outward", echoFadeDuration: 3 } });
    const configured = { ...effect(), preset: "radar", shape: "square", radar: { echoStyle: "blob", echoSize: 175, distanceScale: "logarithmic", decoration: "m314", sweepTrail: 65, brightness: 0.7, sweepType: "angular", sweepDirection: "counterclockwise", echoFadeDuration: 7 }, dynamicRanges: { echoFadeDuration: { minimum: 1, maximum: 12 }, radarBrightness: { minimum: 0.1, maximum: 0.9 }, radarSweepTrail: { minimum: 20, maximum: 80 }, radarEchoSize: { minimum: 50, maximum: 250 } } };
    expect(parseEffectDefinition(configured)).toMatchObject(configured);
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, decoration: "aliens" } })).toMatchObject({ radar: { decoration: "m314" } });
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, decoration: "modern" } })).toMatchObject({ radar: { decoration: "modern" } });
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, decoration: "arcane" } })).toMatchObject({ radar: { decoration: "arcane" } });
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, echoStyle: "rune" } })).toMatchObject({ radar: { echoStyle: "rune" } });
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, sweepDirection: "inward" } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, echoFadeDuration: 31 } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, distanceScale: "exponential" } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, brightness: 2 } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, sweepTrail: 101 } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, echoSize: 401 } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, radar: { ...configured.radar, sweepTrail: true } })).toMatchObject({ radar: { sweepTrail: 100 } });
  });
  it("parses grid visualization defaults and configuration", () => {
    expect(parseEffectDefinition({ ...effect(), preset: "grid" })).toMatchObject({ preset: "grid", grid: { showGrid: false } });
    expect(parseEffectDefinition({ ...effect(), preset: "grid", shape: "square", grid: { showGrid: true } })).toMatchObject({ preset: "grid", shape: "square", grid: { showGrid: true } });
    expect(parseEffectDefinition({ ...effect(), preset: "grid", grid: { showGrid: "yes" } })).toBeNull();
  });
  it("parses optional animation rate strength linking and rejects unknown values", () => {
    expect(parseEffectDefinition({ ...effect(), animation: { mode: "pulse", rate: 2, depth: 0.5, rateStrengthLink: "max" } }))
      .toMatchObject({ animation: { mode: "pulse", rate: 2, depth: 0.5, rateStrengthLink: "max" } });
    expect(parseEffectDefinition({ ...effect(), animation: { mode: "pulse", rate: 2, depth: 0.5 } }))
      .toMatchObject({ animation: { mode: "pulse", rate: 2, depth: 0.5 } });
    expect(parseEffectDefinition({ ...effect(), animation: { mode: "pulse", rate: 2, depth: 0.5, rateStrengthLink: "middle" } })).toBeNull();
  });
  it("parses optional depth and wave-width strength linking", () => {
    const linked = { ...effect(), animation: { mode: "radial-pulse", rate: 2, depth: 0.5, depthStrengthLink: "min", waveWidth: 0.25, waveWidthStrengthLink: "max" } };
    expect(parseEffectDefinition(linked)).toMatchObject(linked);
    expect(parseEffectDefinition({ ...linked, animation: { ...linked.animation, depthStrengthLink: "middle" } })).toBeNull();
    expect(parseEffectDefinition({ ...linked, animation: { ...linked.animation, waveWidthStrengthLink: "middle" } })).toBeNull();
    const { waveWidth: _waveWidth, ...missingWaveWidth } = linked.animation;
    expect(parseEffectDefinition({ ...linked, animation: missingWaveWidth })).toBeNull();
  });
  it("parses shader appearance and geometry strength links", () => {
    const linked = {
      ...effect(), spreadStrengthLink: "max", beamWidth: 40, beamWidthStrengthLink: "min",
      geometry: {
        offsetX: 10, offsetY: -10, innerRadius: 20, outerRadius: 100, width: 120, height: 80, rotation: 15,
        offsetXStrengthLink: "min", offsetYStrengthLink: "max", innerRadiusStrengthLink: "max", outerRadiusStrengthLink: "min",
        widthStrengthLink: "max", heightStrengthLink: "min", rotationStrengthLink: "max",
      },
    };
    expect(parseEffectDefinition(linked)).toMatchObject(linked);
    expect(parseEffectDefinition({ ...linked, spreadStrengthLink: "middle" })).toBeNull();
    expect(parseEffectDefinition({ ...linked, beamWidthStrengthLink: "middle" })).toBeNull();
    expect(parseEffectDefinition({ ...linked, geometry: { ...linked.geometry, widthStrengthLink: "middle" } })).toBeNull();
  });
  it("allows zero softness and rejects negative softness", () => {
    expect(parseEffectDefinition({ ...effect(), spread: 0 })).toMatchObject({ spread: 0 });
    expect(parseEffectDefinition({ ...effect(), spread: -0.01 })).toBeNull();
    expect(parseEffectDefinition({ ...effect(), dynamicRanges: { softness: { minimum: 0, maximum: 4 } } }))
      .toMatchObject({ dynamicRanges: { softness: { minimum: 0, maximum: 4 } } });
  });
  it("parses directional beam endpoint and origin widths", () => {
    expect(parseEffectDefinition({ ...effect(), preset: "beam", beamWidth: 0, beamOriginWidth: 0 }))
      .toMatchObject({ beamWidth: 0, beamOriginWidth: 0 });
    expect(parseEffectDefinition({ ...effect(), preset: "beam", beamWidth: 120, beamOriginWidth: 100 }))
      .toMatchObject({ beamWidth: 120, beamOriginWidth: 100 });
    expect(parseEffectDefinition({ ...effect(), preset: "beam", beamWidth: -1 })).toBeNull();
    expect(parseEffectDefinition({ ...effect(), preset: "beam", beamOriginWidth: -1 })).toBeNull();
    expect(parseEffectDefinition({ ...effect(), preset: "beam", beamOriginWidth: 101 })).toBeNull();
    expect(parseEffectDefinition({ ...effect(), preset: "beam", beamOriginWidth: "wide" })).toBeNull();
  });
  it("parses crossed responsive endpoints and migrates legacy REV ranges", () => {
    const baseGeometry = { offsetX: 0, offsetY: 0, responsiveOffset: 20, innerRadius: 20, outerRadius: 100 };
    expect(parseEffectDefinition({ ...effect(), geometry: { ...baseGeometry, responsiveOffsetRange: { minimum: 60, maximum: -20 } } }))
      .toMatchObject({ dynamicRanges: { responsiveOffset: { minimum: 60, maximum: -20 } } });
    expect(parseEffectDefinition({ ...effect(), geometry: { ...baseGeometry, responsiveOffsetRange: { min: -20, max: 60, reversed: true } } }))
      .toMatchObject({ dynamicRanges: { responsiveOffset: { minimum: 60, maximum: -20 } } });
  });
  it("parses generic dynamic shader ranges and rejects invalid endpoints", () => {
    const configured = { ...effect(), dynamicRanges: { intensity: { minimum: 0.25, maximum: 1.5 }, innerRadius: { minimum: 80, maximum: 20 }, outerRadius: { minimum: 90, maximum: 160, enabled: false } } };
    expect(parseEffectDefinition(configured)).toMatchObject(configured);
    expect(parseEffectDefinition({ ...configured, dynamicRanges: { intensity: { minimum: -1, maximum: 1 } } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, dynamicRanges: { unknown: { minimum: 0, maximum: 1 } } })).toBeNull();
  });
  it("parses shader gradient, intensity, and GM audience options", () => {
    const configured = { ...effect(), colorGradient: { minColor: "#112233" }, intensityStrengthLinked: false, alwaysIncludeGm: true };
    expect(parseEffectDefinition(configured)).toMatchObject(configured);
    expect(parseEffectDefinition({ ...configured, colorGradient: { minColor: "red" } })).toBeNull();
    expect(parseEffectDefinition({ ...configured, intensityStrengthLinked: "yes" })).toBeNull();
    expect(parseEffectDefinition({ ...configured, alwaysIncludeGm: "yes" })).toBeNull();
  });

  it("parses Auras and Emanations preset triggers", () => {
    expect(parseEffectDefinition({ id: "ae", type: "emanation", enabled: true, target: { type: "detector" }, audience: { type: "everyone" }, presetName: "Spirits", removeAllOnDeactivate: true })).toMatchObject({
      type: "integration",
      lifecycle: "continuous",
      providerId: "auras-emanations",
      providerSchemaVersion: 1,
      actionId: "preset-aura",
      parameters: { presetName: "Spirits", cleanup: "remove-all-with-warning" },
    });
  });

  it("parses generic integrations and rejects executable-looking invalid fields", () => {
    const integration = {
      id: "sound", type: "integration", enabled: true, lifecycle: "enter",
      target: { type: "carrier" }, audience: { type: "carrier-owner" },
      providerId: "soundboard-plus", providerSchemaVersion: 1, actionId: "play-one-shot",
      parameters: { soundId: "whisper", volume: 0.5 },
    };
    expect(parseEffectDefinition(integration)).toMatchObject(integration);
    expect(parseEffectDefinition({ ...integration, lifecycle: "eval" })).toBeNull();
    expect(parseEffectDefinition({ ...integration, providerSchemaVersion: 0 })).toBeNull();
  });
});

describe("attachment graph and targets", () => {
  const carrier = item("carrier", undefined, "carrier-owner");
  const belt = item("belt", "carrier");
  const detector = item("detector", "belt", "detector-owner");
  const sibling = item("sibling", "carrier");
  const child = item("child", "detector");
  const unrelated = item("unrelated", undefined, "target-owner");
  const graph = buildAttachmentGraph([carrier, belt, detector, sibling, child, unrelated]);

  it("resolves parents, carriers, and families", () => {
    expect(resolveParent(detector, graph)?.id).toBe("belt");
    expect(resolveCarrier(detector, graph).id).toBe("carrier");
    expect(isSameAttachmentFamily(detector, sibling, graph)).toBe(true);
    expect(isSameAttachmentFamily(detector, child, graph)).toBe(true);
    expect(isSameAttachmentFamily(detector, unrelated, graph)).toBe(false);
  });

  it("resolves every v1 target without fallback", () => {
    expect(resolveEffectTarget({ type: "detector" }, detector, unrelated, graph)?.id).toBe("detector");
    expect(resolveEffectTarget({ type: "parent" }, detector, unrelated, graph)?.id).toBe("belt");
    expect(resolveEffectTarget({ type: "carrier" }, detector, unrelated, graph)?.id).toBe("carrier");
    expect(resolveEffectTarget({ type: "detected-emitter" }, detector, unrelated, graph)?.id).toBe("unrelated");
    expect(resolveEffectTarget({ type: "specific-item", itemId: "unrelated" }, detector, null, graph)?.id).toBe("unrelated");
    expect(resolveEffectTarget({ type: "specific-item", itemId: "missing" }, detector, null, graph)).toBeNull();
    expect(resolveEffectTarget({ type: "parent" }, carrier, null, graph)).toBeNull();
  });

  it.each([
    [{ type: "everyone" } as const, { id: "any", role: "PLAYER" } as const, true],
    [{ type: "gm" } as const, { id: "any", role: "GM" } as const, true],
    [{ type: "gm" } as const, { id: "any", role: "PLAYER" } as const, false],
    [{ type: "players" } as const, { id: "any", role: "PLAYER" } as const, true],
    [{ type: "detector-owner" } as const, { id: "detector-owner", role: "PLAYER" } as const, true],
    [{ type: "carrier-owner" } as const, { id: "carrier-owner", role: "PLAYER" } as const, true],
    [{ type: "target-owner" } as const, { id: "target-owner", role: "PLAYER" } as const, true],
    [{ type: "specific-users", userIds: ["chosen"] } as const, { id: "chosen", role: "PLAYER" } as const, true],
    [{ type: "specific-users", userIds: ["chosen"] } as const, { id: "other", role: "PLAYER" } as const, false],
  ])("resolves audience %#", (audience, player, expected) => expect(isAudienceMember(audience as EffectAudienceV1, player, detector, unrelated, graph)).toBe(expected));
  it("can always include GMs without changing the configured audience", () => {
    const playersOnly = { type: "players" } as const;
    expect(isShaderAudienceMember(playersOnly, true, { id: "gm", role: "GM" }, detector, unrelated, graph)).toBe(true);
    expect(isShaderAudienceMember(playersOnly, false, { id: "gm", role: "GM" }, detector, unrelated, graph)).toBe(false);
    expect(isShaderAudienceMember(playersOnly, true, { id: "player", role: "PLAYER" }, detector, unrelated, graph)).toBe(true);
  });
});

describe("editable metadata names", () => {
  it("preserves valid rule and effect names", () => {
    expect(parseEffectDefinition({ ...effect(), name: "Warning glow" })).toMatchObject({ name: "Warning glow" });
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("named", [{ ...effect(), name: "Warning glow" }]), name: "Intruder alert" }] }))
      .toMatchObject({ rules: [{ name: "Intruder alert", effects: [{ name: "Warning glow" }] }] });
  });

  it("rejects blank or oversized names", () => {
    expect(parseEffectDefinition({ ...effect(), name: " " })).toBeNull();
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("named"), name: "x".repeat(81) }] })).toBeNull();
  });
});

describe("runtime effect identity", () => {
  it("cannot collide across rules, effects, targets, or separator characters", () => {
    const keys = [
      buildRuntimeEffectKey("d", "r1", "e", "t"),
      buildRuntimeEffectKey("d", "r2", "e", "t"),
      buildRuntimeEffectKey("d", "r1", "e2", "t"),
      buildRuntimeEffectKey("d", "r1", "e", "t2"),
      buildRuntimeEffectKey("d:r", "e", "t", "x"),
      buildRuntimeEffectKey("d", "r:e", "t", "x"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("parses Face mechanical effects and rejects invalid configuration", () => {
    const face = { id: "face", type: "mechanical", enabled: true, action: "face", target: { type: "detector" }, faceAngle: 0, pivotX: 0, pivotY: 0, speed: 180 };
    expect(parseEffectDefinition(face)).toEqual({ ...face, reverseOnExit: false });
    const { pivotX: _pivotX, pivotY: _pivotY, ...legacyFace } = face;
    expect(parseEffectDefinition(legacyFace)).toEqual({ ...face, reverseOnExit: false });
    expect(parseEffectDefinition({ ...face, reverseOnExit: true })).toMatchObject({ reverseOnExit: true });
    expect(parseEffectDefinition({ ...face, action: "move" })).toBeNull();
    expect(parseEffectDefinition({ ...face, faceAngle: 360 })).toBeNull();
    expect(parseEffectDefinition({ ...face, speed: 14 })).toBeNull();
    expect(parseEffectDefinition({ ...face, speed: 721 })).toBeNull();
    expect(parseEffectDefinition({ ...face, pivotX: 501 })).toBeNull();
  });

  it("parses Hide/Show mechanical effects and rejects invalid configuration", () => {
    const visibility = { id: "visibility", type: "mechanical", enabled: true, action: "visibility", target: { type: "detector" }, visibility: "hidden", reverseOnExit: true };
    expect(parseEffectDefinition(visibility)).toEqual(visibility);
    expect(parseEffectDefinition({ ...visibility, visibility: "transparent" })).toBeNull();
    expect(parseEffectDefinition({ ...visibility, reverseOnExit: "yes" })).toBeNull();
    expect(parseEffectDefinition({ ...visibility, visibility: "toggle" })).toMatchObject({ visibility: "toggle" });
  });
  it("parses Lock/Unlock state effects and rejects invalid configuration", () => {
    const lock = { id: "lock", type: "mechanical", enabled: true, action: "lock", target: { type: "detector" }, locked: true, reverseOnExit: true };
    expect(parseEffectDefinition(lock)).toEqual(lock);
    expect(parseEffectDefinition({ ...lock, toggle: true })).toEqual({ ...lock, toggle: true });
    expect(parseEffectDefinition({ ...lock, locked: "yes" })).toBeNull();
    expect(parseEffectDefinition({ ...lock, reverseOnExit: 1 })).toBeNull();
  });
  it("parses configured and pending Set Image state effects", () => {
    const pending = { id: "image", type: "mechanical", enabled: true, action: "set-image", target: { type: "detector" }, constrainToOriginalSize: true, reverseOnExit: true };
    const asset = { name: "Wolf", image: { width: 512, height: 256, mime: "image/png", url: "https://example.com/wolf.png" }, grid: { dpi: 256, offset: { x: 256, y: 128 } } };
    expect(parseEffectDefinition(pending)).toEqual(pending);
    expect(parseEffectDefinition({ ...pending, asset })).toEqual({ ...pending, asset });
    expect(parseEffectDefinition({ ...pending, asset: { ...asset, image: { ...asset.image, width: 0 } } })).toBeNull();
    expect(parseEffectDefinition({ ...pending, asset: { ...asset, grid: { ...asset.grid, dpi: 0 } } })).toBeNull();
  });
  it("parses Add/Remove Emitter state effects and permits an unconfigured draft", () => {
    const emitter = { id: "emitter", type: "mechanical", enabled: true, action: "emitter", target: { type: "detector" }, operation: "add", signal: "alarm[20]", reverseOnExit: true };
    expect(parseEffectDefinition(emitter)).toEqual(emitter);
    expect(parseEffectDefinition({ ...emitter, signal: "" })).toEqual({ ...emitter, signal: "" });
    expect(parseEffectDefinition({ ...emitter, operation: "toggle" })).toMatchObject({ operation: "toggle" });
    expect(parseEffectDefinition({ ...emitter, operation: "flip" })).toBeNull();
  });
  it("parses Spotlight light effects with Face-style defaults and validation", () => {
    const spotlight = { id: "spotlight", type: "light", enabled: true, action: "spotlight", duration: "temporary", target: { type: "detector" }, audience: { type: "everyone" }, attenuationRadius: { value: 4 } };
    expect(parseEffectDefinition(spotlight)).toMatchObject({ ...spotlight, spotlightAngle: 0, spotlightSpeed: 180 });
    expect(parseEffectDefinition({ ...spotlight, spotlightAngle: 359, spotlightSpeed: 720 })).toMatchObject({ spotlightAngle: 359, spotlightSpeed: 720 });
    expect(parseEffectDefinition({ ...spotlight, target: { type: "detected-emitter" } })).toMatchObject({ target: { type: "detector" } });
    expect(parseEffectDefinition({ ...spotlight, spotlightAngle: 360 })).toBeNull();
    expect(parseEffectDefinition({ ...spotlight, spotlightSpeed: 14 })).toBeNull();
  });
  it("separates all-mode effects by detected emitter", () => {
    expect(buildRuntimeEffectKey("d", "r", "e", "same-target", "shader", "", "", "a"))
      .not.toBe(buildRuntimeEffectKey("d", "r", "e", "same-target", "shader", "", "", "b"));
  });
});

describe("scene settings", () => {
  it("parses supported distance methods and defaults invalid settings", () => {
    expect(parseSceneSettings({ version: 1, distanceMethod: "euclidean" })).toEqual({ version: 1, distanceMethod: "euclidean" });
    expect(parseSceneSettings({ version: 1, distanceMethod: "grid" })).toEqual({ version: 1, distanceMethod: "scene" });
    expect(parseSceneSettings({ version: 1, distanceMethod: "taxicab" })).toEqual(DEFAULT_SCENE_SETTINGS);
    expect(parseSceneSettings(undefined)).toEqual(DEFAULT_SCENE_SETTINGS);
  });
});

describe("rule aggregation", () => {
  const detector = item("detector");
  const evaluation = (emitterId: string, distance: number, strength: number) => ({
    detector,
    rule: rule("aggregate"),
    matchingEmitterCount: 3,
    detectedEmitter: item(emitterId),
    distance,
    strength,
  });

  it("selects only the nearest candidate in closest mode", () => {
    const selected = selectRuleEvaluations(rule("nearest"), [evaluation("far", 40, 0.3), evaluation("near", 10, 0.9)]);
    expect(selected.map((entry) => entry.detectedEmitter?.id)).toEqual(["near"]);
  });

  it("ignores an inactive nearer candidate when choosing the closest detection", () => {
    const selected = selectRuleEvaluations(rule("nearest-band"), [evaluation("too-close", 2, 0), evaluation("in-band", 10, 0.9)]);
    expect(selected.map((entry) => entry.detectedEmitter?.id)).toEqual(["in-band"]);
  });

  it("selects every positive-strength candidate in distance order for all mode", () => {
    const allRule = { ...rule("all"), aggregation: "all" as const };
    const selected = selectRuleEvaluations(allRule, [evaluation("far", 70, 0), evaluation("middle", 30, 0.5), evaluation("near", 10, 0.9)]);
    expect(selected.map((entry) => entry.detectedEmitter?.id)).toEqual(["near", "middle"]);
  });

  it("excludes hidden emitters only when the rule requests it", async () => {
    const hiddenEmitter = { ...item("hidden"), visible: false, metadata: { [EMITTER_KEY]: { version: 1, signals: ["orc"] } } };
    const visibleEmitter = { ...item("visible"), position: { x: 10, y: 0 }, metadata: { [EMITTER_KEY]: { version: 1, signals: ["orc"] } } };
    const items = [detector, hiddenEmitter, visibleEmitter];
    const signalIndex = indexEmittersBySignal(items);
    const graph = buildAttachmentGraph(items);
    const grid = { dpi: 100, type: "SQUARE" as const, measurement: "CHEBYSHEV" as const };
    await expect(evaluateRule(detector, { ...rule("include"), range: { inner: 0, outer: 60 }, aggregation: "all" }, signalIndex, graph, 5, grid, "euclidean"))
      .resolves.toMatchObject({ matchingEmitterCount: 2 });
    await expect(evaluateRule(detector, { ...rule("ignore"), range: { inner: 0, outer: 60 }, aggregation: "all", ignoreHidden: true }, signalIndex, graph, 5, grid, "euclidean"))
      .resolves.toMatchObject({ matchingEmitterCount: 1, evaluations: [{ detectedEmitter: { id: "visible" } }] });
  });

  it("excludes emitters on configured OBR layers", async () => {
    const character = { ...item("character"), metadata: { [EMITTER_KEY]: { version: 1, signals: ["orc"] } } };
    const prop = { ...item("prop"), layer: "PROP" as const, position: { x: 10, y: 0 }, metadata: { [EMITTER_KEY]: { version: 1, signals: ["orc"] } } };
    const items = [detector, character, prop];
    const result = await evaluateRule(detector, { ...rule("layers"), range: { inner: 0, outer: 60 }, aggregation: "all", excludeLayers: ["CHARACTER"] }, indexEmittersBySignal(items), buildAttachmentGraph(items), 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean");
    expect(result).toMatchObject({ matchingEmitterCount: 1, evaluations: [{ detectedEmitter: { id: "prop" } }] });
  });

  it("detects items by trimmed, case-insensitive item name", async () => {
    const named = { ...item("named"), name: "Red   Dragon", position: { x: 100, y: 0 } };
    const items = [detector, named];
    const result = await evaluateRule(detector, { ...rule("name"), signal: "red   dragon", source: { type: "item-name" } }, { signals: new Map(), lights: [], items }, buildAttachmentGraph(items), 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean");
    expect(result).toMatchObject({ matchingEmitterCount: 1, evaluations: [{ detectedEmitter: { id: "named" } }] });
  });

  it("detects an image item by its trimmed, case-insensitive OBR label text", async () => {
    const labeled = { ...item("labeled"), name: "Ranger", position: { x: 100, y: 0 }, textItemType: "LABEL", text: { plainText: "Red   Dragon" } } as Item;
    const items = [detector, labeled];
    const result = await evaluateRule(detector, { ...rule("label"), signal: "red   dragon", source: { type: "item-label" } }, { signals: new Map(), lights: [], items }, buildAttachmentGraph(items), 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean");
    expect(result).toMatchObject({ matchingEmitterCount: 1, evaluations: [{ detectedEmitter: { id: "labeled", name: "Ranger" } }] });
  });

  it("does not treat image overlay text as an item label", async () => {
    const textOverlay = { ...item("overlay"), position: { x: 100, y: 0 }, textItemType: "TEXT", text: { plainText: "Red Dragon" } } as Item;
    const items = [detector, textOverlay];
    await expect(evaluateRule(detector, { ...rule("label"), signal: "red-dragon", source: { type: "item-label" } }, { signals: new Map(), lights: [], items }, buildAttachmentGraph(items), 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean"))
      .resolves.toMatchObject({ matchingEmitterCount: 0 });
  });

  it("indexes ranged tags by base signal and keeps each emitter's widest cap", () => {
    const capped = { ...item("capped"), metadata: { [EMITTER_KEY]: { version: 1, signals: ["light[20]", "light[60]"] } } };
    const unlimited = { ...item("unlimited"), metadata: { [EMITTER_KEY]: { version: 1, signals: ["light[10]", "light"] } } };
    const index = indexEmittersBySignal([capped, unlimited]);
    expect(index.has("light[20]")).toBe(false);
    expect(index.get("light")).toEqual([
      { item: capped, range: 60 },
      { item: unlimited },
    ]);
  });

  it("does not index disabled emitters", () => {
    const disabled = { ...item("disabled"), metadata: { [EMITTER_KEY]: { version: 1, enabled: false, signals: ["light"] } } };
    expect(indexEmittersBySignal([disabled]).has("light")).toBe(false);
  });

  it("includes the emitter cap boundary and excludes emitters beyond it", async () => {
    const atBoundary = { ...item("boundary"), position: { x: 400, y: 0 }, metadata: { [EMITTER_KEY]: { version: 1, signals: ["light[20]"] } } };
    const beyond = { ...item("beyond"), position: { x: 401, y: 0 }, metadata: { [EMITTER_KEY]: { version: 1, signals: ["light[20]"] } } };
    const items = [detector, atBoundary, beyond];
    const result = await evaluateRule(detector, { ...rule("caps"), signal: "light", aggregation: "all" }, indexEmittersBySignal(items), buildAttachmentGraph(items), 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean");
    expect(result.matchingEmitterCount).toBe(1);
    expect(result.evaluations.map((entry) => entry.detectedEmitter?.id)).toEqual(["boundary"]);
  });

  it("retains the source match count when the detector range rejects a capped emitter", async () => {
    const emitter = { ...item("capped"), position: { x: 500, y: 0 }, metadata: { [EMITTER_KEY]: { version: 1, signals: ["light[50]"] } } };
    const items = [detector, emitter];
    const result = await evaluateRule(detector, { ...rule("short-detector"), signal: "light", range: { inner: 5, outer: 20 } }, indexEmittersBySignal(items), buildAttachmentGraph(items), 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean");
    expect(result).toMatchObject({ matchingEmitterCount: 1, evaluations: [{ distance: null, strength: 0, detectedEmitter: null }] });
  });

  it.each(["nearest", "all"] as const)("excludes too-close emitters from %s banded evaluation", async (aggregation) => {
    const tooClose = { ...item("too-close"), position: { x: 40, y: 0 }, metadata: { [EMITTER_KEY]: { version: 1, signals: ["orc"] } } };
    const inBand = { ...item("in-band"), position: { x: 200, y: 0 }, metadata: { [EMITTER_KEY]: { version: 1, signals: ["orc"] } } };
    const items = [detector, tooClose, inBand];
    const result = await evaluateRule(detector, { ...rule(`band-${aggregation}`), aggregation }, indexEmittersBySignal(items), buildAttachmentGraph(items), 5, { dpi: 100, type: "SQUARE", measurement: "CHEBYSHEV" }, "euclidean");
    expect(result.matchingEmitterCount).toBe(2);
    expect(result.evaluations).toMatchObject([{ detectedEmitter: { id: "in-band" }, distance: 10 }]);
  });

  it("applies the band to distance-based OBR lights but not Within Light Radius rules", async () => {
    const light = { ...item("light"), type: "LIGHT", position: { x: 40, y: 0 }, attenuationRadius: 100, sourceRadius: 0, falloff: 0.5, innerAngle: 360, outerAngle: 360, lightType: "PRIMARY" } as Light;
    const sources = { signals: new Map(), lights: [light], items: [] };
    const graph = buildAttachmentGraph([detector, light]);
    const grid = { dpi: 100, type: "SQUARE" as const, measurement: "CHEBYSHEV" as const };
    const distanceRule = { ...rule("light-distance"), source: { type: "obr-light" as const, detection: "distance" as const } };
    const areaRule = { ...rule("light-area"), source: { type: "obr-light" as const, detection: "within-radius" as const } };
    await expect(evaluateRule(detector, distanceRule, sources, graph, 5, grid, "euclidean"))
      .resolves.toMatchObject({ evaluations: [{ detectedEmitter: null, strength: 0 }] });
    const area = await evaluateRule(detector, areaRule, sources, graph, 5, grid, "euclidean");
    expect(area.evaluations[0]).toMatchObject({ detectedEmitter: { id: "light" }, distance: 2 });
    expect(area.evaluations[0].strength).toBeGreaterThan(0);
  });
});

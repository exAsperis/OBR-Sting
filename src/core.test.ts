import type { Item } from "@owlbear-rodeo/sdk";
import { describe, expect, it } from "vitest";
import { EMITTER_KEY } from "./constants";
import { buildRuntimeEffectKey } from "./effects/runtimeKey";
import { parseDetectorMetadata, parseEffectDefinition, parseEmitterMetadata } from "./metadata/parse";
import { calculateStrength } from "./proximity/strength";
import { evaluateRule, indexEmittersBySignal, selectRuleEvaluations } from "./proximity/evaluate";
import { getSceneDistance, toSceneUnits } from "./proximity/distance";
import { buildAttachmentGraph, isSameAttachmentFamily, resolveCarrier, resolveParent } from "./scene/attachments";
import { isAudienceMember, isShaderAudienceMember, resolveEffectTarget } from "./scene/resolve";
import { normalizeSignal, normalizeSignals } from "./signals/normalize";
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
  id, enabled: true, signal: "orc", range: { outer: 60, inner: 5 }, aggregation: "nearest", ignoreHidden: false, falloff: "smoothstep", effects,
});

describe("signal normalization", () => {
  it.each([[" Orc ", "orc"], ["ORC", "orc"], ["Red   Hand", "red-hand"], [" faction:RED_hand ", "faction:red_hand"]])("normalizes %s", (input, expected) => expect(normalizeSignal(input)).toBe(expected));
  it("removes duplicates and empty signals", () => expect(normalizeSignals([" Orc ", "ORC", " "])).toEqual(["orc"]));
  it("parses normalized emitter metadata", () => expect(parseEmitterMetadata({ version: 1, signals: [" Orc ", "ORC"] })).toEqual({ version: 1, signals: ["orc"] }));
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
    expect(calculateStrength(2, 60, 5, "linear")).toBe(1);
  });
  it("calculates linear and smoothstep midpoints", () => {
    expect(calculateStrength(32.5, 60, 5, "linear")).toBeCloseTo(0.5);
    expect(calculateStrength(32.5, 60, 5, "smoothstep")).toBeCloseTo(0.5);
  });
  it("calculates binary falloff", () => {
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
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [{ ...rule("a"), range: { inner: 10, outer: 10 } }] })).toBeNull();
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
    expect(parseEffectDefinition({ ...radial, animation: { ...radial.animation, waveWidth: 2 } })).toBeNull();
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
    expect(parseEffectDefinition(face)).toEqual(face);
    const { pivotX: _pivotX, pivotY: _pivotY, ...legacyFace } = face;
    expect(parseEffectDefinition(legacyFace)).toEqual(face);
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
    await expect(evaluateRule(detector, { ...rule("include"), aggregation: "all" }, signalIndex, graph, 5, grid, "euclidean"))
      .resolves.toMatchObject({ matchingEmitterCount: 2 });
    await expect(evaluateRule(detector, { ...rule("ignore"), aggregation: "all", ignoreHidden: true }, signalIndex, graph, 5, grid, "euclidean"))
      .resolves.toMatchObject({ matchingEmitterCount: 1, evaluations: [{ detectedEmitter: { id: "visible" } }] });
  });
});

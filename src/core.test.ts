import type { Item } from "@owlbear-rodeo/sdk";
import { describe, expect, it } from "vitest";
import { buildRuntimeEffectKey } from "./effects/runtimeKey";
import { parseDetectorMetadata, parseEffectDefinition, parseEmitterMetadata } from "./metadata/parse";
import { calculateStrength } from "./proximity/strength";
import { toSceneUnits } from "./proximity/distance";
import { buildAttachmentGraph, isSameAttachmentFamily, resolveCarrier, resolveParent } from "./scene/attachments";
import { isAudienceMember, resolveEffectTarget } from "./scene/resolve";
import { normalizeSignal, normalizeSignals } from "./signals/normalize";
import type { DetectionRuleV1, EffectAudienceV1, EffectDefinitionV1 } from "./types";

const item = (id: string, attachedTo?: string, owner = `${id}-owner`): Item => ({
  id, type: "IMAGE", name: id, visible: true, locked: false, createdUserId: owner,
  zIndex: 0, lastModified: "", lastModifiedUserId: owner, position: { x: 0, y: 0 },
  rotation: 0, scale: { x: 1, y: 1 }, metadata: {}, layer: attachedTo ? "ATTACHMENT" : "CHARACTER",
  ...(attachedTo ? { attachedTo } : {}),
});

const effect = (id = "effect-1"): EffectDefinitionV1 => ({
  id, type: "shader", enabled: true, target: { type: "detector" }, audience: { type: "everyone" },
  preset: "glow", color: "#55aaff", maxIntensity: 1, spread: 1,
});

const rule = (id: string, effects: EffectDefinitionV1[] = []): DetectionRuleV1 => ({
  id, enabled: true, signal: "orc", range: { outer: 60, inner: 5 }, aggregation: "nearest", falloff: "smoothstep", effects,
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
  it("parses valid shader geometry and rejects inverted radii", () => {
    const configured = { ...effect(), geometry: { offsetX: 20, offsetY: -15, innerRadius: 30, outerRadius: 120 } };
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("a", [configured])] })?.rules[0].effects[0]).toMatchObject(configured);
    const invalid = { ...effect(), geometry: { offsetX: 0, offsetY: 0, innerRadius: 80, outerRadius: 40 } };
    expect(parseDetectorMetadata({ version: 1, enabled: true, rules: [rule("a", [invalid])] })).toBeNull();
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
});

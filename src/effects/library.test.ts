import { describe, expect, it } from "vitest";
import { instantiateLibraryEffect, loadEffectLibrary, parseEffectLibrary } from "./library";

const glow = {
  id: "template-effect",
  type: "shader" as const,
  enabled: true,
  target: { type: "detector" as const },
  audience: { type: "everyone" as const },
  preset: "glow" as const,
  shape: "circle" as const,
  color: "#55aaff",
  maxIntensity: 1,
  spread: 1,
};

describe("effects library", () => {
  it("parses valid entries and ignores invalid entries", () => {
    expect(parseEffectLibrary({ version: 1, entries: [
      { id: "entry", name: "  Blue glow  ", effect: glow },
      { id: "bad", name: "", effect: glow },
    ] }).entries).toEqual([{ id: "entry", name: "Blue glow", effect: glow }]);
  });

  it("instantiates an independent effect with a fresh runtime id", () => {
    const effect = instantiateLibraryEffect({ id: "entry", name: "Blue glow", effect: glow });
    expect(effect).toMatchObject({ type: "shader", color: "#55aaff" });
    expect(effect.id).not.toBe(glow.id);
  });

  it("loads browser-local data and tolerates malformed JSON", () => {
    const serialized = JSON.stringify({ version: 1, entries: [{ id: "entry", name: "Blue glow", effect: glow }] });
    expect(loadEffectLibrary({ getItem: () => serialized }, "library").entries).toHaveLength(1);
    expect(loadEffectLibrary({ getItem: () => "not json" }, "library").entries).toEqual([]);
  });

  it("round-trips reusable Face effects in the v1 library", () => {
    const face = { id: "face", type: "mechanical" as const, enabled: true, action: "face" as const, target: { type: "detector" as const }, faceAngle: 45, speed: 180 };
    const parsed = parseEffectLibrary({ version: 1, entries: [{ id: "turn", name: "Face threat", effect: face }] });
    expect(parsed.entries[0].effect).toEqual(face);
    expect(instantiateLibraryEffect(parsed.entries[0])).toMatchObject({ type: "mechanical", action: "face", faceAngle: 45, speed: 180 });
  });

  it("round-trips reusable Hide/Show effects in the v1 library", () => {
    const visibility = { id: "visibility", type: "mechanical" as const, enabled: true, action: "visibility" as const, target: { type: "detector" as const }, visibility: "hidden" as const, reverseOnExit: true };
    const parsed = parseEffectLibrary({ version: 1, entries: [{ id: "hide", name: "Hide nearby", effect: visibility }] });
    expect(parsed.entries[0].effect).toEqual(visibility);
    expect(instantiateLibraryEffect(parsed.entries[0])).toMatchObject({ type: "mechanical", action: "visibility", visibility: "hidden", reverseOnExit: true });
  });
});

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
  placement: "above" as const,
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

  it("preserves animation rate strength linking", () => {
    const linked = { ...glow, animation: { mode: "radial-pulse" as const, rate: 3, depth: 0.5, waveWidth: 0.25, rateStrengthLink: "max" as const, depthStrengthLink: "min" as const, waveWidthStrengthLink: "max" as const } };
    const parsed = parseEffectLibrary({ version: 1, entries: [{ id: "linked", name: "Linked pulse", effect: linked }] });
    expect(parsed.entries[0].effect).toMatchObject({ animation: { rate: 3, rateStrengthLink: "max", depthStrengthLink: "min", waveWidthStrengthLink: "max" } });
    expect(instantiateLibraryEffect(parsed.entries[0])).toMatchObject({ animation: { rate: 3, rateStrengthLink: "max", depthStrengthLink: "min", waveWidthStrengthLink: "max" } });
  });

  it("round-trips Grid visualization settings", () => {
    const grid = { ...glow, preset: "grid" as const, shape: "square" as const, grid: { showGrid: true, showImages: true } };
    const parsed = parseEffectLibrary({ version: 1, entries: [{ id: "grid", name: "Tactical grid", effect: grid }] });
    expect(parsed.entries[0].effect).toMatchObject({ preset: "grid", shape: "square", grid: { showGrid: true, showImages: true } });
    expect(instantiateLibraryEffect(parsed.entries[0])).toMatchObject({ preset: "grid", grid: { showGrid: true, showImages: true } });
  });

  it("loads browser-local data and tolerates malformed JSON", () => {
    const serialized = JSON.stringify({ version: 1, entries: [{ id: "entry", name: "Blue glow", effect: glow }] });
    expect(loadEffectLibrary({ getItem: () => serialized }, "library").entries).toHaveLength(1);
    expect(loadEffectLibrary({ getItem: () => "not json" }, "library").entries).toEqual([]);
  });

  it("round-trips reusable Face effects in the v1 library", () => {
    const face = { id: "face", type: "mechanical" as const, enabled: true, action: "face" as const, target: { type: "detector" as const }, faceAngle: 45, pivotX: 150, pivotY: -50, speed: 180, reverseOnExit: true };
    const parsed = parseEffectLibrary({ version: 1, entries: [{ id: "turn", name: "Face threat", effect: face }] });
    expect(parsed.entries[0].effect).toEqual(face);
    expect(instantiateLibraryEffect(parsed.entries[0])).toMatchObject({ type: "mechanical", action: "face", faceAngle: 45, pivotX: 150, pivotY: -50, speed: 180 });
  });

  it("round-trips reusable Hide/Show effects in the v1 library", () => {
    const visibility = { id: "visibility", type: "mechanical" as const, enabled: true, action: "visibility" as const, target: { type: "detector" as const }, visibility: "hidden" as const, reverseOnExit: true };
    const parsed = parseEffectLibrary({ version: 1, entries: [{ id: "hide", name: "Hide nearby", effect: visibility }] });
    expect(parsed.entries[0].effect).toEqual(visibility);
    expect(instantiateLibraryEffect(parsed.entries[0])).toMatchObject({ type: "mechanical", action: "visibility", visibility: "hidden", reverseOnExit: true });
  });

  it("round-trips Set Image assets and Add/Remove Emitter settings", () => {
    const setImage = { id: "image", type: "mechanical" as const, enabled: true, action: "set-image" as const, target: { type: "detector" as const }, asset: { name: "Wolf", image: { width: 200, height: 100, mime: "image/png", url: "https://example.com/wolf.png" }, grid: { dpi: 100, offset: { x: 100, y: 50 } } }, constrainToOriginalSize: true, reverseOnExit: true };
    const emitter = { id: "emitter", type: "mechanical" as const, enabled: true, action: "emitter" as const, target: { type: "detector" as const }, operation: "remove" as const, signal: "alarm[20]", reverseOnExit: false };
    const parsed = parseEffectLibrary({ version: 1, entries: [{ id: "image-entry", name: "Werewolf", effect: setImage }, { id: "emitter-entry", name: "Quiet alarm", effect: emitter }] });
    expect(parsed.entries.map((entry) => entry.effect)).toEqual([setImage, emitter]);
    expect(instantiateLibraryEffect(parsed.entries[0])).toMatchObject({ action: "set-image", asset: { name: "Wolf" }, constrainToOriginalSize: true });
    expect(instantiateLibraryEffect(parsed.entries[1])).toMatchObject({ action: "emitter", operation: "remove", signal: "alarm[20]", reverseOnExit: false });
  });
});

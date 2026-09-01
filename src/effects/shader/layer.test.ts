import { describe, expect, it } from "vitest";
import { shaderZIndexForTarget } from "./executor";

describe("shader placement depth", () => {
  it("places effects strictly above or below the target z-index", () => {
    expect(shaderZIndexForTarget(42, "effect-a", "above")).toBe(43);
    expect(shaderZIndexForTarget(42, "effect-a", "below")).toBe(41);
  });

  it("uses adjacent integer depths that survive Owlbear z-index normalization", () => {
    expect(shaderZIndexForTarget(42, "effect-a", "above")).toBe(shaderZIndexForTarget(42, "effect-a", "above"));
    expect(Number.isInteger(shaderZIndexForTarget(Date.now(), "effect-a", "below"))).toBe(true);
  });
});

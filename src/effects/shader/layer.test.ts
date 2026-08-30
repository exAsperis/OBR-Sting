import { describe, expect, it } from "vitest";
import { shaderZIndexForTarget } from "./executor";

describe("shader placement depth", () => {
  it("places effects strictly above or below the target z-index", () => {
    expect(shaderZIndexForTarget(42, "effect-a", "above")).toBeGreaterThan(42);
    expect(shaderZIndexForTarget(42, "effect-a", "below")).toBeLessThan(42);
  });

  it("uses stable fractional offsets to order multiple effects", () => {
    expect(shaderZIndexForTarget(42, "effect-a", "above")).toBe(shaderZIndexForTarget(42, "effect-a", "above"));
    expect(shaderZIndexForTarget(42, "effect-a", "above")).not.toBe(shaderZIndexForTarget(42, "effect-b", "above"));
  });
});

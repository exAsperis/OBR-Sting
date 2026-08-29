import { describe, expect, it } from "vitest";
import { stableEffectZIndex } from "./zIndex";

describe("native effect z-index", () => {
  it("is stable for a runtime key and separates different contexts", () => {
    expect(stableEffectZIndex("detector|rule|effect|emitter-a")).toBe(stableEffectZIndex("detector|rule|effect|emitter-a"));
    expect(stableEffectZIndex("detector|rule|effect|emitter-a")).not.toBe(stableEffectZIndex("detector|rule|effect|emitter-b"));
  });

  it("stays in the reserved local-effect range", () => {
    expect(stableEffectZIndex("runtime-key")).toBeGreaterThanOrEqual(1_000_000);
    expect(stableEffectZIndex("runtime-key")).toBeLessThan(2_000_000);
  });
});

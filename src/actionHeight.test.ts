import { describe, expect, it } from "vitest";
import { clampActionHeight } from "./actionHeight";

describe("clampActionHeight", () => {
  it("preserves a user-selected height on a tall viewport", () => {
    expect(clampActionHeight(540, 900)).toBe(540);
  });

  it("allows heights above the old 700px default when the viewport has room", () => {
    expect(clampActionHeight(900, 1200)).toBe(900);
  });

  it("prevents the iframe bottom from extending beyond a shorter viewport", () => {
    expect(clampActionHeight(700, 700)).toBe(588);
  });

  it("enforces the normal minimum when screen space allows it", () => {
    expect(clampActionHeight(100, 900)).toBe(320);
  });

  it("allows a smaller safety height when the screen cannot fit the normal minimum", () => {
    expect(clampActionHeight(700, 300)).toBe(188);
  });
});

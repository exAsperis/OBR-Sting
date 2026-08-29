import { describe, expect, it } from "vitest";
import { advanceFaceRotation, faceBearing, normalizeAngle, shortestAngleDelta } from "./face";

describe("Face rotation geometry", () => {
  it.each([
    [{ x: 0, y: -10 }, 0],
    [{ x: 10, y: 0 }, 90],
    [{ x: 0, y: 10 }, 180],
    [{ x: -10, y: 0 }, 270],
  ])("uses north as zero for emitter position %#", (emitter, expected) => {
    expect(faceBearing({ x: 0, y: 0 }, emitter, 0)).toBe(expected);
  });

  it("subtracts artwork face calibration from the desired item rotation", () => {
    expect(faceBearing({ x: 0, y: 0 }, { x: 0, y: -10 }, 90)).toBe(270);
  });

  it("normalizes angles and crosses the boundary along the shortest arc", () => {
    expect(normalizeAngle(-10)).toBe(350);
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });

  it("advances at degrees per second and lands exactly on the desired angle", () => {
    expect(advanceFaceRotation(0, 90, 180, 0.25)).toBe(45);
    expect(advanceFaceRotation(45, 90, 180, 0.25)).toBe(90);
    expect(advanceFaceRotation(90, 90, 180, 1)).toBe(90);
  });
});

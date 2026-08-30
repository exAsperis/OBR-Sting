import { describe, expect, it } from "vitest";
import { advanceFaceRotation, faceBearing, localPivotFromOrigin, normalizeAngle, positionForFixedPivot, positionForPivotRotation, resolvePivot, rotatePositionAroundPivot, shortestAngleDelta, unrotatedItemSize } from "./face";

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

  it("resolves pivots beyond the item bounds", () => {
    expect(resolvePivot({ x: 100, y: 200 }, { width: 80, height: 40 }, 0, 250, -300)).toEqual({ x: 200, y: 140 });
  });

  it("rotates a stable unrotated-image pivot vector into world space", () => {
    const pivot = resolvePivot({ x: 100, y: 100 }, { width: 80, height: 40 }, 90, 100, 0);
    expect(pivot.x).toBeCloseTo(100);
    expect(pivot.y).toBeCloseTo(140);
  });

  it("resolves the same world pivot after the item orbits and rotates", () => {
    const size = { width: 100, height: 50 };
    const initialCenter = { x: 100, y: 100 };
    const pivot = resolvePivot(initialCenter, size, 0, 200, 0);
    const nextCenter = rotatePositionAroundPivot(initialCenter, pivot, 90);
    const resolvedAgain = resolvePivot(nextCenter, size, 90, 200, 0);
    expect(resolvedAgain.x).toBeCloseTo(pivot.x);
    expect(resolvedAgain.y).toBeCloseTo(pivot.y);
  });

  it("uses intrinsic scaled image dimensions instead of rotated bounds", () => {
    const image = { type: "IMAGE", image: { width: 200, height: 100 }, scale: { x: 0.5, y: 2 } };
    expect(unrotatedItemSize(image as never, { width: 212, height: 212 })).toEqual({ width: 100, height: 200 });
  });

  it("moves an item around a fixed world-space pivot", () => {
    const moved = rotatePositionAroundPivot({ x: 0, y: 0 }, { x: 10, y: 0 }, 90);
    expect(moved.x).toBeCloseTo(10);
    expect(moved.y).toBeCloseTo(-10);
  });

  it("leaves position unchanged for the default center pivot", () => {
    expect(positionForPivotRotation({ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 100, y: 100 }, 90)).toEqual({ x: 50, y: 50 });
  });

  it("translates the item by the center's orbit around an external pivot", () => {
    const position = positionForPivotRotation({ x: 50, y: 50 }, { x: 100, y: 100 }, { x: 200, y: 100 }, 90);
    expect(position.x).toBeCloseTo(150);
    expect(position.y).toBeCloseTo(-50);
  });

  it("keeps a pivot fixed relative to Owlbear's native item origin", () => {
    const origin = { x: 80, y: 120 };
    const pivot = { x: 200, y: 100 };
    const localPivot = localPivotFromOrigin(origin, pivot, 30);
    const nextOrigin = positionForFixedPivot(pivot, localPivot, 150);
    const worldOffset = rotatePositionAroundPivot(localPivot, { x: 0, y: 0 }, 150);
    expect(nextOrigin.x + worldOffset.x).toBeCloseTo(pivot.x);
    expect(nextOrigin.y + worldOffset.y).toBeCloseTo(pivot.y);
  });
});

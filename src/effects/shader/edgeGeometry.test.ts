import { describe, expect, it } from "vitest";
import { barIndicatorLayout, edgeIndicatorLayout, segmentRectInterval, transformedBounds } from "./edgeGeometry";

const offscreen = (x: number, y: number) => ({ left: x - 5, top: y - 5, right: x + 5, bottom: y + 5 });

describe("edge indicator geometry", () => {
  it.each([
    [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 80, y: 50 }],
    [{ x: 50, y: 50 }, { x: -50, y: 50 }, { x: 20, y: 50 }],
    [{ x: 50, y: 50 }, { x: 50, y: -50 }, { x: 50, y: 20 }],
    [{ x: 50, y: 50 }, { x: 50, y: 150 }, { x: 50, y: 80 }],
  ])("places on each inset edge", (target, emitter, center) => {
    expect(edgeIndicatorLayout(target, emitter, offscreen(emitter.x, emitter.y), { width: 100, height: 100 }, 20, 10)).toMatchObject({ center, visible: true });
  });

  it("uses the intersection nearest the emitter when both endpoints are outside", () => {
    expect(edgeIndicatorLayout({ x: -50, y: 50 }, { x: 150, y: 50 }, offscreen(150, 50), { width: 100, height: 100 }, 20, 10).center).toEqual({ x: 80, y: 50 });
  });

  it("hides visible, grazing, non-crossing, and zero-length emitters", () => {
    expect(edgeIndicatorLayout({ x: 50, y: 50 }, { x: 105, y: 50 }, { left: 99, top: 45, right: 111, bottom: 55 }, { width: 100, height: 100 }, 20, 10).visible).toBe(false);
    expect(edgeIndicatorLayout({ x: -20, y: -20 }, { x: 120, y: -5 }, offscreen(120, -5), { width: 100, height: 100 }, 20, 10).visible).toBe(false);
    expect(edgeIndicatorLayout({ x: -20, y: 20 }, { x: -10, y: 80 }, offscreen(-10, 80), { width: 100, height: 100 }, 20, 10).visible).toBe(false);
    expect(edgeIndicatorLayout({ x: 120, y: 50 }, { x: 120, y: 50 }, offscreen(120, 50), { width: 100, height: 100 }, 20, 10).visible).toBe(false);
  });

  it("handles corners, cramped viewports, segment misses, and transformed bounds", () => {
    const corner = edgeIndicatorLayout({ x: 50, y: 50 }, { x: 150, y: 150 }, offscreen(150, 150), { width: 100, height: 100 }, 20, 10);
    expect(corner.center.x).toBeCloseTo(80); expect(corner.center.y).toBeCloseTo(80);
    expect(edgeIndicatorLayout({ x: 5, y: 5 }, { x: 50, y: 50 }, offscreen(50, 50), { width: 20, height: 20 }, 40, 10).visible).toBe(false);
    expect(segmentRectInterval({ x: -5, y: -5 }, { x: -1, y: -1 }, { left: 0, top: 0, right: 10, bottom: 10 })).toBeNull();
    expect(transformedBounds([{ x: 8, y: 2 }, { x: -2, y: 6 }, { x: 4, y: -3 }])).toEqual({ left: -2, top: -3, right: 8, bottom: 6 });
  });

  it.each([
    [{ x: 50, y: 50 }, { x: 50, y: -50 }, 0],
    [{ x: 50, y: 50 }, { x: 150, y: 50 }, 1],
    [{ x: 50, y: 50 }, { x: 50, y: 150 }, 2],
    [{ x: 50, y: 50 }, { x: -50, y: 50 }, 3],
  ])("identifies the viewport edge used by a bar", (target, emitter, edge) => {
    expect(barIndicatorLayout(target, emitter, offscreen(emitter.x, emitter.y), { width: 100, height: 100 }, 5)).toMatchObject({ edge, visible: true });
  });
});

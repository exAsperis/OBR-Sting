export interface ScreenPoint { x: number; y: number }
export interface ScreenRect { left: number; top: number; right: number; bottom: number }
export interface EdgeIndicatorLayout { center: ScreenPoint; direction: ScreenPoint; visible: boolean }
export interface BarIndicatorLayout extends EdgeIndicatorLayout { edge: 0 | 1 | 2 | 3 }

const intersects = (a: ScreenRect, b: ScreenRect) => a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom;

/** Return the segment interval contained by rect, or null when it never enters. */
export function segmentRectInterval(start: ScreenPoint, end: ScreenPoint, rect: ScreenRect): [number, number] | null {
  const delta = { x: end.x - start.x, y: end.y - start.y };
  if (Math.hypot(delta.x, delta.y) < 1e-6) return null;
  let enter = 0, exit = 1;
  for (const [p, q] of [[-delta.x, start.x - rect.left], [delta.x, rect.right - start.x], [-delta.y, start.y - rect.top], [delta.y, rect.bottom - start.y]] as const) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t); else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }
  return [enter, exit];
}

/** Edge order is top, right, bottom, left. */
export function barIndicatorLayout(
  target: ScreenPoint,
  emitter: ScreenPoint,
  emitterBounds: ScreenRect,
  viewport: { width: number; height: number },
  inset: number,
  thickness = 20,
): BarIndicatorLayout {
  const layout = edgeIndicatorLayout(target, emitter, emitterBounds, viewport, thickness, inset);
  if (!layout.visible) return { ...layout, edge: 0 };
  const centerline = Math.max(0, inset) + thickness / 2;
  const distances = [
    Math.abs(layout.center.y - centerline),
    Math.abs(layout.center.x - (viewport.width - centerline)),
    Math.abs(layout.center.y - (viewport.height - centerline)),
    Math.abs(layout.center.x - centerline),
  ];
  return { ...layout, edge: distances.indexOf(Math.min(...distances)) as 0 | 1 | 2 | 3 };
}

export function edgeIndicatorLayout(
  target: ScreenPoint,
  emitter: ScreenPoint,
  emitterBounds: ScreenRect,
  viewport: { width: number; height: number },
  size: number,
  inset: number,
): EdgeIndicatorLayout {
  const hidden = { center: { x: 0, y: 0 }, direction: { x: 0, y: -1 }, visible: false };
  const viewportRect = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  if (viewport.width <= 0 || viewport.height <= 0 || intersects(emitterBounds, viewportRect)) return hidden;
  const dx = emitter.x - target.x, dy = emitter.y - target.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6 || !segmentRectInterval(target, emitter, viewportRect)) return hidden;
  const clearance = Math.max(0, inset) + Math.max(0, size) / 2;
  const safeRect = { left: clearance, top: clearance, right: viewport.width - clearance, bottom: viewport.height - clearance };
  if (safeRect.left > safeRect.right || safeRect.top > safeRect.bottom) return hidden;
  const safeInterval = segmentRectInterval(target, emitter, safeRect);
  if (!safeInterval) return hidden;
  const t = safeInterval[1];
  return {
    center: { x: target.x + dx * t, y: target.y + dy * t },
    direction: { x: dx / length, y: dy / length },
    visible: true,
  };
}

export function transformedBounds(points: ScreenPoint[]): ScreenRect {
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

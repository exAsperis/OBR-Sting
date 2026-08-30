import type { BoundingBox, Item } from "@owlbear-rodeo/sdk";
import type { DesiredEffect, MechanicalEffectDefinitionV1 } from "../../types";

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function shortestAngleDelta(from: number, to: number): number {
  const delta = normalizeAngle(to) - normalizeAngle(from);
  return delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
}

export function advanceFaceRotation(current: number, desired: number, speed: number, elapsedSeconds: number): number {
  const delta = shortestAngleDelta(current, desired);
  const step = Math.min(Math.abs(delta), speed * Math.max(0, elapsedSeconds));
  return normalizeAngle(current + Math.sign(delta) * step);
}

export function faceBearing(
  target: { x: number; y: number },
  emitter: { x: number; y: number },
  faceAngle: number,
): number {
  const clockwiseFromNorth = Math.atan2(emitter.x - target.x, target.y - emitter.y) * 180 / Math.PI;
  return normalizeAngle(clockwiseFromNorth - faceAngle);
}

export function unrotatedItemSize(item: Item, bounds: Pick<BoundingBox, "width" | "height">) {
  const sized = item as Item & { image?: { width?: number; height?: number }; width?: number; height?: number };
  const rawWidth = sized.image?.width ?? sized.width;
  const rawHeight = sized.image?.height ?? sized.height;
  if (typeof rawWidth === "number" && Number.isFinite(rawWidth) && rawWidth > 0 && typeof rawHeight === "number" && Number.isFinite(rawHeight) && rawHeight > 0) {
    return { width: rawWidth * Math.abs(item.scale.x), height: rawHeight * Math.abs(item.scale.y) };
  }
  return { width: bounds.width, height: bounds.height };
}

export function resolvePivot(
  center: { x: number; y: number },
  size: { width: number; height: number },
  rotation: number,
  pivotX: number,
  pivotY: number,
) {
  const offset = rotatePositionAroundPivot(
    { x: size.width * pivotX / 200, y: size.height * pivotY / 200 },
    { x: 0, y: 0 },
    rotation,
  );
  return { x: center.x + offset.x, y: center.y + offset.y };
}

export function rotatePositionAroundPivot(
  position: { x: number; y: number },
  pivot: { x: number; y: number },
  angleDelta: number,
) {
  const radians = angleDelta * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = position.x - pivot.x;
  const y = position.y - pivot.y;
  return { x: pivot.x + x * cosine - y * sine, y: pivot.y + x * sine + y * cosine };
}

export function positionForPivotRotation(
  position: { x: number; y: number },
  center: { x: number; y: number },
  pivot: { x: number; y: number },
  angleDelta: number,
) {
  const nextCenter = rotatePositionAroundPivot(center, pivot, angleDelta);
  return { x: position.x + nextCenter.x - center.x, y: position.y + nextCenter.y - center.y };
}

export function localPivotFromOrigin(
  origin: { x: number; y: number },
  pivot: { x: number; y: number },
  rotation: number,
) {
  return rotatePositionAroundPivot({ x: pivot.x - origin.x, y: pivot.y - origin.y }, { x: 0, y: 0 }, -rotation);
}

export function positionForFixedPivot(
  pivot: { x: number; y: number },
  localPivot: { x: number; y: number },
  rotation: number,
) {
  const worldOffset = rotatePositionAroundPivot(localPivot, { x: 0, y: 0 }, rotation);
  return { x: pivot.x - worldOffset.x, y: pivot.y - worldOffset.y };
}

export function compareFaceContexts(left: DesiredEffect, right: DesiredEffect): number {
  const distance = (left.distance ?? Infinity) - (right.distance ?? Infinity);
  if (distance !== 0) return distance;
  const leftEffect = left.effect as MechanicalEffectDefinitionV1;
  const rightEffect = right.effect as MechanicalEffectDefinitionV1;
  return [left.detector.id, left.rule.id, leftEffect.id].join("\u0000")
    .localeCompare([right.detector.id, right.rule.id, rightEffect.id].join("\u0000"));
}

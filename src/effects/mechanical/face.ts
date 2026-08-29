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

export function compareFaceContexts(left: DesiredEffect, right: DesiredEffect): number {
  const distance = (left.distance ?? Infinity) - (right.distance ?? Infinity);
  if (distance !== 0) return distance;
  const leftEffect = left.effect as MechanicalEffectDefinitionV1;
  const rightEffect = right.effect as MechanicalEffectDefinitionV1;
  return [left.detector.id, left.rule.id, leftEffect.id].join("\u0000")
    .localeCompare([right.detector.id, right.rule.id, rightEffect.id].join("\u0000"));
}

import type { Falloff } from "../types";

export function calculateRawStrength(distance: number, outer: number, inner: number): number {
  if (distance >= outer) return 0;
  if (distance <= inner) return 1;
  return Math.max(0, Math.min(1, (outer - distance) / (outer - inner)));
}

export function applyFalloff(raw: number, falloff: Falloff, distance: number, outer: number): number {
  if (falloff === "binary") return distance <= outer ? 1 : 0;
  if (falloff === "smoothstep") return raw * raw * (3 - 2 * raw);
  return raw;
}

export function calculateStrength(distance: number, outer: number, inner: number, falloff: Falloff): number {
  return applyFalloff(calculateRawStrength(distance, outer, inner), falloff, distance, outer);
}

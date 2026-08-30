import type { Falloff } from "../types";

export function calculateRawStrength(distance: number, outer: number, inner: number): number {
  if (distance >= outer) return 0;
  if (distance <= inner) return 1;
  return Math.max(0, Math.min(1, (outer - distance) / (outer - inner)));
}

export function applyFalloff(raw: number, falloff: Falloff, distance: number, outer: number): number {
  if (falloff === "binary") return distance <= outer ? 1 : 0;
  if (falloff === "smoothstep") return raw * raw * (3 - 2 * raw);
  // A fixed factor of 9 gives a pronounced initial drop and a long tail while
  // preserving exact strengths of 1 and 0 at the inner and outer boundaries.
  if (falloff === "logarithmic") return 1 - Math.log1p(9 * (1 - raw)) / Math.log(10);
  return raw;
}

export function calculateStrength(distance: number, outer: number, inner: number, falloff: Falloff): number {
  return applyFalloff(calculateRawStrength(distance, outer, inner), falloff, distance, outer);
}

import type { GridType } from "@owlbear-rodeo/sdk";

export type DistanceMethod = "scene" | "chessboard" | "alternating" | "euclidean" | "manhattan" | "hexagon";
export interface SceneSettingsV1 { version: 1; distanceMethod: DistanceMethod }
export const DEFAULT_SCENE_SETTINGS: SceneSettingsV1 = { version: 1, distanceMethod: "scene" };
const METHODS = new Set<DistanceMethod>(["scene", "chessboard", "alternating", "euclidean", "manhattan", "hexagon"]);

export function parseSceneSettings(value: unknown): SceneSettingsV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_SCENE_SETTINGS;
  const candidate = value as Record<string, unknown>;
  const distanceMethod = candidate.distanceMethod === "grid" ? "scene" : candidate.distanceMethod;
  return candidate.version === 1 && METHODS.has(distanceMethod as DistanceMethod)
    ? { version: 1, distanceMethod: distanceMethod as DistanceMethod }
    : DEFAULT_SCENE_SETTINGS;
}

export const isHexGrid = (type: GridType) => type === "HEX_VERTICAL" || type === "HEX_HORIZONTAL";
export function isDistanceMethodValidForGrid(method: DistanceMethod, type: GridType): boolean {
  if (method === "scene" || method === "euclidean") return true;
  return isHexGrid(type) ? method === "hexagon" : method !== "hexagon";
}

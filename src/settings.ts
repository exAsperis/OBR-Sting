export type DistanceMethod = "grid" | "euclidean";

export interface SceneSettingsV1 {
  version: 1;
  distanceMethod: DistanceMethod;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettingsV1 = { version: 1, distanceMethod: "grid" };

export function parseSceneSettings(value: unknown): SceneSettingsV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_SCENE_SETTINGS;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && (candidate.distanceMethod === "grid" || candidate.distanceMethod === "euclidean")
    ? { version: 1, distanceMethod: candidate.distanceMethod }
    : DEFAULT_SCENE_SETTINGS;
}

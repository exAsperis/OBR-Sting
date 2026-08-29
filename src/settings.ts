export type DistanceMethod = "grid" | "euclidean";

export interface RoomSettingsV1 {
  version: 1;
  distanceMethod: DistanceMethod;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettingsV1 = { version: 1, distanceMethod: "grid" };

export function parseRoomSettings(value: unknown): RoomSettingsV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_ROOM_SETTINGS;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && (candidate.distanceMethod === "grid" || candidate.distanceMethod === "euclidean")
    ? { version: 1, distanceMethod: candidate.distanceMethod }
    : DEFAULT_ROOM_SETTINGS;
}

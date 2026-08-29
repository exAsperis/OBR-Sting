import OBR, { type Vector2 } from "@owlbear-rodeo/sdk";
import type { DistanceMethod } from "../settings";

/** Convert the grid API's cell distance into the scene's displayed distance unit. */
export function toSceneUnits(gridDistance: number, scaleMultiplier: number): number {
  return gridDistance * scaleMultiplier;
}

export async function getSceneDistance(
  from: Vector2,
  to: Vector2,
  scaleMultiplier: number,
  dpi: number,
  method: DistanceMethod,
): Promise<number> {
  if (method === "euclidean") {
    return toSceneUnits(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(dpi, 1), scaleMultiplier);
  }
  return toSceneUnits(await OBR.scene.grid.getDistance(from, to), scaleMultiplier);
}

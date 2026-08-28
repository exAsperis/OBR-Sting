import OBR, { type Vector2 } from "@owlbear-rodeo/sdk";

/** Convert the grid API's cell distance into the scene's displayed distance unit. */
export function toSceneUnits(gridDistance: number, scaleMultiplier: number): number {
  return gridDistance * scaleMultiplier;
}

export async function getSceneDistance(
  from: Vector2,
  to: Vector2,
  scaleMultiplier: number,
): Promise<number> {
  return toSceneUnits(await OBR.scene.grid.getDistance(from, to), scaleMultiplier);
}

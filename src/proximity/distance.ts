import OBR, { type GridMeasurement, type GridType, type Vector2 } from "@owlbear-rodeo/sdk";
import { isDistanceMethodValidForGrid, type DistanceMethod } from "../settings";

export interface GridDistanceContext { dpi: number; type: GridType; measurement: GridMeasurement }
export function toSceneUnits(gridDistance: number, scaleMultiplier: number): number { return gridDistance * scaleMultiplier; }
export function worldToSceneUnits(worldDistance: number, dpi: number, scaleMultiplier: number): number { return toSceneUnits(worldDistance / Math.max(dpi, 1), scaleMultiplier); }
export function sceneToWorldUnits(sceneDistance: number, dpi: number, scaleMultiplier: number): number { return sceneDistance / Math.max(scaleMultiplier, Number.EPSILON) * Math.max(dpi, 1); }

function squareCoordinates(point: Vector2, dpi: number, type: GridType): Vector2 {
  if (type === "SQUARE") return { x: point.x / dpi, y: point.y / dpi };
  const width = dpi * (type === "ISOMETRIC" ? Math.sqrt(3) : 2);
  return { x: point.y / dpi + point.x / width, y: point.y / dpi - point.x / width };
}

function squareDistance(from: Vector2, to: Vector2, dpi: number, type: GridType, method: DistanceMethod): number {
  const a = squareCoordinates(from, dpi, type), b = squareCoordinates(to, dpi, type);
  const dx = Math.abs(Math.round(b.x) - Math.round(a.x));
  const dy = Math.abs(Math.round(b.y) - Math.round(a.y));
  const diagonal = Math.min(dx, dy);
  if (method === "manhattan") return dx + dy;
  if (method === "alternating") return Math.max(dx, dy) + Math.floor(diagonal / 2);
  return Math.max(dx, dy);
}

interface Cube { x: number; y: number; z: number }
function roundCube(cube: Cube): Cube {
  let x = Math.round(cube.x), y = Math.round(cube.y), z = Math.round(cube.z);
  const xd = Math.abs(x - cube.x), yd = Math.abs(y - cube.y), zd = Math.abs(z - cube.z);
  if (xd > yd && xd > zd) x = -y - z;
  else if (yd > zd) y = -x - z;
  else z = -x - y;
  return { x, y, z };
}

function hexCoordinates(point: Vector2, dpi: number, type: GridType): Cube {
  const horizontal = type === "HEX_HORIZONTAL";
  const primary = (horizontal ? point.y : point.x) / dpi;
  const secondary = (horizontal ? point.x : point.y) / dpi;
  const q = primary - secondary / Math.sqrt(3);
  const r = 2 * secondary / Math.sqrt(3);
  return roundCube({ x: q, z: r, y: -q - r });
}

function hexDistance(from: Vector2, to: Vector2, dpi: number, type: GridType): number {
  const a = hexCoordinates(from, dpi, type), b = hexCoordinates(to, dpi, type);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

export async function getSceneDistance(from: Vector2, to: Vector2, scaleMultiplier: number, context: GridDistanceContext, requested: DistanceMethod): Promise<number> {
  const dpi = Math.max(context.dpi, 1);
  const method = isDistanceMethodValidForGrid(requested, context.type) ? requested : "scene";
  if (method === "scene") return toSceneUnits(await OBR.scene.grid.getDistance(from, to), scaleMultiplier);
  if (method === "euclidean") return toSceneUnits(Math.hypot(to.x - from.x, to.y - from.y) / dpi, scaleMultiplier);
  if (method === "hexagon") return toSceneUnits(hexDistance(from, to, dpi, context.type), scaleMultiplier);
  return toSceneUnits(squareDistance(from, to, dpi, context.type, method), scaleMultiplier);
}

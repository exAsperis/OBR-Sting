import OBR, { buildLine, type Item } from "@owlbear-rodeo/sdk";
import { DETECTOR_KEY, PIVOT_DEBUG_KEY } from "../constants";
import { resolvePivot, unrotatedItemSize } from "../effects/mechanical/face";
import { parseDetectorMetadata } from "../metadata/parse";
import { buildAttachmentGraph } from "../scene/attachments";
import { resolveEffectTarget } from "../scene/resolve";
import type { MechanicalFaceEffectDefinitionV1 } from "../types";

let markerIds: string[] = [];
let revision = 0;

async function removeMarkers(): Promise<void> {
  const ids = markerIds;
  markerIds = [];
  if (ids.length) try { await OBR.scene.local.deleteItems(ids); } catch { /* best-effort debug UI */ }
}

export async function syncSelectedFacePivots(items: Item[]): Promise<void> {
  const currentRevision = ++revision;
  await removeMarkers();
  const [role, selection] = await Promise.all([OBR.player.getRole(), OBR.player.getSelection()]);
  if (currentRevision !== revision || role !== "GM" || selection?.length !== 1) return;
  const selected = items.find((item) => item.id === selection[0]);
  const detector = selected ? parseDetectorMetadata(selected.metadata[DETECTOR_KEY]) : null;
  if (!selected || !detector) return;
  const graph = buildAttachmentGraph(items);
  const configured = detector.rules.flatMap((rule) => rule.effects)
    .filter((effect): effect is MechanicalFaceEffectDefinitionV1 => effect.type === "mechanical" && effect.action === "face");
  const lines = [];
  for (const effect of configured) {
    const target = resolveEffectTarget(effect.target, selected, null, graph);
    if (!target) continue;
    try {
      const bounds = await OBR.scene.items.getItemBounds([target.id]);
      const size = unrotatedItemSize(target, bounds);
      const pivot = resolvePivot(bounds.center, size, target.rotation, effect.pivotX, effect.pivotY);
      const halfSize = Math.max(8, Math.min(24, Math.min(size.width, size.height) * 0.12));
      for (const axis of ["horizontal", "vertical"] as const) lines.push(buildLine()
        .name(`Sting configured Face pivot ${axis}`)
        .startPosition(axis === "horizontal" ? { x: pivot.x - halfSize, y: pivot.y } : { x: pivot.x, y: pivot.y - halfSize })
        .endPosition(axis === "horizontal" ? { x: pivot.x + halfSize, y: pivot.y } : { x: pivot.x, y: pivot.y + halfSize })
        .strokeColor("#ff3366").strokeWidth(3).locked(true).disableHit(true).disableAutoZIndex(true)
        .zIndex(2_000_001).layer("POINTER").metadata({ [PIVOT_DEBUG_KEY]: { targetId: target.id, source: "selection" } }).build());
    } catch { /* skip unresolved bounds */ }
  }
  if (currentRevision !== revision || !lines.length) return;
  try {
    await OBR.scene.local.addItems(lines);
    if (currentRevision === revision) markerIds = lines.map((line) => line.id);
    else await OBR.scene.local.deleteItems(lines.map((line) => line.id));
  } catch { /* best-effort debug UI */ }
}

export async function clearSelectedFacePivots(): Promise<void> {
  revision++;
  await removeMarkers();
}

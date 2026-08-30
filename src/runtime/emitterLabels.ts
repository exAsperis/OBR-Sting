import OBR, { buildLabel, type Item } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY, EMITTER_LABEL_DEBUG_KEY } from "../constants";
import { parseEmitterMetadata } from "../metadata/parse";

let labelIds: string[] = [];
let revision = 0;

async function removeKnownLabels(): Promise<void> {
  const known = new Set(labelIds);
  try {
    for (const item of await OBR.scene.local.getItems()) {
      if (item.metadata[EMITTER_LABEL_DEBUG_KEY] !== undefined) known.add(item.id);
    }
  } catch { /* best-effort local debug overlay */ }
  labelIds = [];
  if (known.size) try { await OBR.scene.local.deleteItems([...known]); } catch { /* best-effort local debug overlay */ }
}

export async function labelAllEmitters(items: Item[]): Promise<number> {
  const currentRevision = ++revision;
  await removeKnownLabels();
  const emitters = items.flatMap((item) => {
    const emitter = parseEmitterMetadata(item.metadata[EMITTER_KEY]);
    return emitter?.signals.length ? [{ item, signals: emitter.signals }] : [];
  });
  const labels = [];
  for (const { item, signals } of emitters) {
    try {
      const bounds = await OBR.scene.items.getItemBounds([item.id]);
      labels.push(buildLabel()
        .name(`Sting emitter signals: ${item.name || item.id}`)
        .plainText(signals.join(", "))
        .position({ x: bounds.center.x, y: bounds.min.y - 12 })
        .attachedTo(item.id)
        .fontSize(18)
        .fontWeight(700)
        .padding(6)
        .fillColor("#ffffff")
        .backgroundColor("#1f2937")
        .backgroundOpacity(0.9)
        .cornerRadius(6)
        .pointerDirection("DOWN")
        .pointerWidth(10)
        .pointerHeight(8)
        .locked(true)
        .disableHit(true)
        .disableAutoZIndex(true)
        .disableAttachmentBehavior(["ROTATION", "SCALE", "VISIBLE", "LOCKED", "COPY"])
        .zIndex(2_000_002)
        .layer("POINTER")
        .metadata({ [EMITTER_LABEL_DEBUG_KEY]: { emitterId: item.id } })
        .build());
    } catch { /* skip emitters whose bounds cannot be resolved */ }
  }
  if (currentRevision !== revision || !labels.length) return 0;
  try {
    await OBR.scene.local.addItems(labels);
    if (currentRevision === revision) labelIds = labels.map((label) => label.id);
    else await OBR.scene.local.deleteItems(labels.map((label) => label.id));
  } catch { return 0; }
  return labels.length;
}

export async function clearEmitterLabels(): Promise<void> {
  revision += 1;
  await removeKnownLabels();
}

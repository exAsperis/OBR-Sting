import OBR, { buildLabel, type Item } from "@owlbear-rodeo/sdk";
import { DETECTOR_KEY, DETECTOR_LABEL_DEBUG_KEY } from "../constants";
import { parseDetectorMetadata } from "../metadata/parse";
import type { DebugRuleState } from "../types";

let labelIds: string[] = [];
let revision = 0;

async function removeKnownLabels(): Promise<void> {
  const known = new Set(labelIds);
  try {
    for (const item of await OBR.scene.local.getItems()) {
      if (item.metadata[DETECTOR_LABEL_DEBUG_KEY] !== undefined) known.add(item.id);
    }
  } catch { /* best-effort local debug overlay */ }
  labelIds = [];
  if (known.size) try { await OBR.scene.local.deleteItems([...known]); } catch { /* best-effort local debug overlay */ }
}

function ruleSummary(rule: DebugRuleState): string[] {
  const area = rule.detectionArea === "source-area" ? "source area" : `${rule.range.inner}–${rule.range.outer}`;
  const selection = rule.aggregation === "all" ? "all detected items" : "closest detected item";
  const lines = [
    `${rule.ruleName ?? "Rule"}: ${rule.signal || "OBR Light"} · ${area} · ${selection}`,
    `Matches ${rule.matchingEmitterCount} · Active ${rule.activeEmitterCount}`,
  ];
  for (const detection of rule.detections) lines.push(`↳ ${detection.emitterName} · ${detection.distance.toFixed(2)} · strength ${detection.strength.toFixed(3)}`);
  for (const effect of rule.effects) {
    const identity = effect.providerId ? `${effect.providerId} · ${effect.actionId}` : effect.actionId ? `${effect.type} · ${effect.actionId}` : effect.type;
    lines.push(`↳ ${identity} · ${effect.lifecycle} · ${effect.transition} · ${effect.targetType} → ${effect.targetName ?? "unresolved"}`);
    lines.push(`  ${effect.audience ?? "GM authority"} · ${effect.audienceMatch ? "execution client" : "not executing here"} · ${effect.executionStatus ?? effect.localItemId ?? "inactive"}`);
  }
  return lines;
}

export async function labelAllDetectors(items: Item[], rules: DebugRuleState[]): Promise<number> {
  const currentRevision = ++revision;
  await removeKnownLabels();
  const rulesByDetector = new Map<string, DebugRuleState[]>();
  for (const rule of rules) rulesByDetector.set(rule.detectorId, [...(rulesByDetector.get(rule.detectorId) ?? []), rule]);
  const detectors = items.filter((item) => parseDetectorMetadata(item.metadata[DETECTOR_KEY]) !== null);
  const labels = [];
  for (const item of detectors) {
    try {
      const bounds = await OBR.scene.items.getItemBounds([item.id]);
      const itemRules = rulesByDetector.get(item.id) ?? [];
      const text = itemRules.length ? itemRules.flatMap((rule, index) => [...(index ? [""] : []), ...ruleSummary(rule)]).join("\n") : "No active detector rules.";
      labels.push(buildLabel()
        .name(`Sting detector runtime: ${item.name || item.id}`)
        .plainText(text)
        .width(360)
        .height("AUTO")
        .position({ x: bounds.center.x, y: bounds.max.y + 12 })
        .attachedTo(item.id)
        .fontSize(12)
        .fontWeight(500)
        .textAlign("LEFT")
        .lineHeight(1.25)
        .padding(6)
        .fillColor("#ffffff")
        .backgroundColor("#1f2937")
        .backgroundOpacity(0.9)
        .cornerRadius(6)
        .pointerDirection("UP")
        .pointerWidth(10)
        .pointerHeight(8)
        .locked(true)
        .disableHit(true)
        .disableAutoZIndex(true)
        .disableAttachmentBehavior(["ROTATION", "SCALE", "VISIBLE", "LOCKED", "COPY"])
        .zIndex(2_000_002)
        .layer("POINTER")
        .metadata({ [DETECTOR_LABEL_DEBUG_KEY]: { detectorId: item.id } })
        .build());
    } catch { /* skip detectors whose bounds cannot be resolved */ }
  }
  if (currentRevision !== revision || !labels.length) return 0;
  try {
    await OBR.scene.local.addItems(labels);
    if (currentRevision === revision) labelIds = labels.map((label) => label.id);
    else await OBR.scene.local.deleteItems(labels.map((label) => label.id));
  } catch { return 0; }
  return labels.length;
}

export async function clearDetectorLabels(): Promise<void> {
  revision += 1;
  await removeKnownLabels();
}

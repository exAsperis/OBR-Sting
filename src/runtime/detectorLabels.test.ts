import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@owlbear-rodeo/sdk";
import { DETECTOR_KEY, DETECTOR_LABEL_DEBUG_KEY } from "../constants";
import type { DebugRuleState } from "../types";
import { clearDetectorLabels, labelAllDetectors } from "./detectorLabels";

const { addItems, deleteItems, getItems, getItemBounds, built } = vi.hoisted(() => ({
  addItems: vi.fn(), deleteItems: vi.fn(), getItems: vi.fn(), getItemBounds: vi.fn(), built: [] as Item[],
}));

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: { scene: { local: { addItems, deleteItems, getItems }, items: { getItemBounds } } },
  buildLabel: () => {
    const value: Record<string, unknown> = { id: `detector-label-${built.length + 1}`, metadata: {} };
    const builder = new Proxy({}, {
      get: (_target, property) => property === "build" ? () => { built.push(value as unknown as Item); return value; } : (...args: unknown[]) => { value[String(property)] = args.length === 1 ? args[0] : args; return builder; },
    });
    return builder;
  },
}));

const detector = (id: string, configured = true) => ({
  id, name: id, metadata: configured ? { [DETECTOR_KEY]: { version: 1, enabled: true, rules: [] } } : {},
}) as unknown as Item;

const debugRule = (detectorId: string): DebugRuleState => ({
  detectorId, detectorName: detectorId, ruleId: "rule-1", ruleName: "Alarm", signal: "orc", detectionArea: "distance", aggregation: "nearest", range: { inner: 5, outer: 60 }, matchingEmitterCount: 2, activeEmitterCount: 1,
  detections: [{ emitterName: "Orc", distance: 10, strength: 0.9 }],
  effects: [{ effectId: "effect-1", targetType: "detector", targetName: detectorId, audience: "everyone", audienceMatch: true, runtimeKey: "runtime", localItemId: "local", type: "shader", lifecycle: "continuous", transition: "enter" }],
});

describe("detector debug labels", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    built.length = 0;
    getItems.mockResolvedValue([]);
    getItemBounds.mockResolvedValue({ min: { x: 0, y: 10 }, max: { x: 20, y: 30 }, center: { x: 10, y: 20 }, width: 20, height: 20 });
    addItems.mockResolvedValue(undefined);
    deleteItems.mockResolvedValue(undefined);
    await clearDetectorLabels();
    vi.clearAllMocks();
  });

  it("creates a local label below each detector with its scoped runtime details", async () => {
    const count = await labelAllDetectors([detector("a"), detector("b"), detector("plain", false)], [debugRule("a")]);
    expect(count).toBe(2);
    expect(addItems).toHaveBeenCalledOnce();
    const labels = built.map((entry) => entry as unknown as Record<string, unknown>);
    expect(labels[0].plainText).toContain("Alarm: orc · 5–60 · closest detected item");
    expect(labels[0].plainText).toContain("Matches 2 · Active 1");
    expect(labels[0].plainText).toContain("Orc · 10.00 · strength 0.900");
    expect(labels[0].plainText).toContain("everyone · execution client · local");
    expect(labels[1].plainText).toBe("No active detector rules.");
    expect(labels.map((entry) => entry.position)).toEqual([{ x: 10, y: 42 }, { x: 10, y: 42 }]);
    expect(labels.map((entry) => entry.pointerDirection)).toEqual(["UP", "UP"]);
    expect(labels[0]).toMatchObject({ width: 360, height: "AUTO", fontSize: 12, fontWeight: 500, textAlign: "LEFT", lineHeight: 1.25 });
    expect((built[0].metadata[DETECTOR_LABEL_DEBUG_KEY] as { detectorId: string }).detectorId).toBe("a");
  });

  it("replaces stale detector labels before drawing", async () => {
    getItems.mockResolvedValue([{ id: "stale", metadata: { [DETECTOR_LABEL_DEBUG_KEY]: { detectorId: "old" } } }] as unknown as Item[]);
    await labelAllDetectors([detector("a")], [debugRule("a")]);
    expect(deleteItems).toHaveBeenCalledWith(["stale"]);
  });

  it("returns zero when the scene has no configured detectors", async () => {
    expect(await labelAllDetectors([detector("plain", false)], [])).toBe(0);
    expect(addItems).not.toHaveBeenCalled();
  });
});

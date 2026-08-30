import type { Item } from "@owlbear-rodeo/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesiredEffect, MechanicalEffectDefinitionV1 } from "../../types";

const { startItemInteraction, updateItems } = vi.hoisted(() => ({ startItemInteraction: vi.fn(), updateItems: vi.fn() }));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: { interaction: { startItemInteraction }, scene: { items: { updateItems } } } }));

import { MechanicalEffectExecutor } from "./executor";

const item = (id: string, x: number, y: number, rotation = 0): Item => ({
  id, type: "IMAGE", name: id, visible: true, locked: false, createdUserId: "gm", zIndex: 0,
  lastModified: "", lastModifiedUserId: "gm", position: { x, y }, rotation, scale: { x: 1, y: 1 }, metadata: {}, layer: "CHARACTER",
});
const effect: MechanicalEffectDefinitionV1 = { id: "face", type: "mechanical", enabled: true, action: "face", target: { type: "detector" }, faceAngle: 0, speed: 180 };
let updatedRotations: number[] = [];
let persistedRotations: number[] = [];
let persistedVisibilities: boolean[] = [];
function context(target: Item, emitter: Item, distance: number, role: "GM" | "PLAYER" = "GM", ids = ["detector", "rule", "face"]): DesiredEffect {
  return {
    effect: { ...effect, id: ids[2] }, runtimeKey: ids.join("/"), target, detectedEmitter: emitter, distance,
    detector: item(ids[0], 0, 0), rule: { id: ids[1] }, localPlayer: { id: role.toLowerCase(), role, connectionId: `${role}-1` }, party: [],
    audienceMatch: role === "GM",
  } as unknown as DesiredEffect;
}
function visibilityContext(target: Item, emitter: Item, distance: number, visibility: "hidden" | "shown" = "hidden", reverseOnExit = true, ids = ["detector", "rule", "visibility"]): DesiredEffect {
  const result = context(target, emitter, distance, "GM", ids);
  result.effect = { id: ids[2], type: "mechanical", enabled: true, action: "visibility", target: { type: "detector" }, visibility, reverseOnExit };
  return result;
}

describe("MechanicalEffectExecutor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    updatedRotations = [];
    persistedRotations = [];
    persistedVisibilities = [];
    startItemInteraction.mockResolvedValue([(recipe: (draft: Item) => void) => { const draft = item("target", 0, 0); recipe(draft); updatedRotations.push(draft.rotation); return draft; }, vi.fn()]);
    updateItems.mockImplementation(async (_ids: string[], recipe: (drafts: Item[]) => void) => { const draft = item("target", 0, 0); recipe([draft]); persistedRotations.push(draft.rotation); persistedVisibilities.push(draft.visible); });
  });
  afterEach(() => vi.useRealTimers());

  it("only lets the GM start shared Face interactions", async () => {
    const target = item("target", 0, 0);
    const emitter = item("emitter", 10, 0);
    await new MechanicalEffectExecutor().reconcile({ desired: [context(target, emitter, 10, "PLAYER")], events: [] });
    expect(startItemInteraction).not.toHaveBeenCalled();
  });

  it("elects only the first GM connection when several GM tabs are present", async () => {
    const target = item("target", 0, 0);
    const emitter = item("emitter", 10, 0);
    const losing = context(target, emitter, 10);
    losing.localPlayer.connectionId = "gm-b";
    losing.party = [
      { id: "gm", role: "GM", connectionId: "gm-a" },
    ] as DesiredEffect["party"];
    const report = await new MechanicalEffectExecutor().reconcile({ desired: [losing], events: [] });
    expect(startItemInteraction).not.toHaveBeenCalled();
    expect(report.statuses.get(losing.runtimeKey)).toBe("authority-standby");
  });

  it("elects the local session when its connection sorts before every other GM", async () => {
    const target = item("target", 0, 0);
    const winning = context(target, item("emitter", 10, 0), 10);
    winning.localPlayer.connectionId = "gm-a";
    winning.party = [{ id: "gm", role: "GM", connectionId: "gm-b" }] as DesiredEffect["party"];
    const report = await new MechanicalEffectExecutor().reconcile({ desired: [winning], events: [] });
    expect(startItemInteraction).toHaveBeenCalledOnce();
    expect(report.statuses.get(winning.runtimeKey)).toBe("turning");
  });

  it("silently ignores a target that is its own detected emitter", async () => {
    const same = item("same", 0, 0);
    await new MechanicalEffectExecutor().reconcile({ desired: [context(same, same, 0)], events: [] });
    expect(startItemInteraction).not.toHaveBeenCalled();
  });

  it("chooses the closest emitter when all-mode contexts share a target", async () => {
    const target = item("target", 0, 0);
    const near = context(target, item("near", 10, 0), 10, "GM", ["detector", "rule", "near-effect"]);
    const far = context(target, item("far", -20, 0), 20, "GM", ["detector", "rule", "far-effect"]);
    const report = await new MechanicalEffectExecutor().reconcile({ desired: [far, near], events: [] });
    expect(startItemInteraction).toHaveBeenCalledTimes(1);
    expect(report.statuses.get(near.runtimeKey)).toBe("turning");
    expect(report.statuses.get(far.runtimeKey)).toBe("superseded");
  });

  it("fails silently when Owlbear refuses to start an interaction", async () => {
    startItemInteraction.mockRejectedValueOnce(new Error("permission"));
    const ctx = context(item("target", 0, 0), item("emitter", 10, 0), 10);
    const report = await new MechanicalEffectExecutor().reconcile({ desired: [ctx], events: [] });
    expect(report.statuses.get(ctx.runtimeKey)).toBe("skipped");
  });

  it("advances rotations from background-safe timer ticks", async () => {
    const executor = new MechanicalEffectExecutor();
    await executor.reconcile({ desired: [context(item("target", 0, 0), item("emitter", 10, 0), 10)], events: [] });
    await vi.advanceTimersByTimeAsync(250);
    expect(updatedRotations.at(-1)).toBeCloseTo(45, 0);
    await executor.clear();
  });

  it("persists the final rotation before ending the temporary interaction", async () => {
    const stop = vi.fn();
    startItemInteraction.mockResolvedValueOnce([(recipe: (draft: Item) => void) => { const draft = item("target", 0, 0); recipe(draft); return draft; }, stop]);
    const executor = new MechanicalEffectExecutor();
    await executor.reconcile({ desired: [context(item("target", 0, 0), item("emitter", 10, 0), 10)], events: [] });
    await vi.advanceTimersByTimeAsync(500);
    expect(persistedRotations.at(-1)).toBe(90);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("hides on entry and reverses only after the final all-mode emitter exits", async () => {
    const executor = new MechanicalEffectExecutor();
    const target = item("target", 0, 0);
    const near = visibilityContext(target, item("near", 10, 0), 10, "hidden", true, ["detector", "rule", "visibility"]);
    const far = visibilityContext(target, item("far", 20, 0), 20, "hidden", true, ["detector", "rule", "visibility"]);
    await executor.reconcile({ desired: [near, far], events: [] });
    expect(persistedVisibilities).toEqual([false]);
    await executor.reconcile({ desired: [far], events: [] });
    expect(persistedVisibilities).toEqual([false]);
    await executor.reconcile({ desired: [], events: [] });
    expect(persistedVisibilities).toEqual([false, true]);
  });

  it("leaves the entry visibility in place when reverse is disabled", async () => {
    const executor = new MechanicalEffectExecutor();
    const ctx = visibilityContext(item("target", 0, 0), item("emitter", 10, 0), 10, "shown", false);
    await executor.reconcile({ desired: [ctx], events: [] });
    await executor.reconcile({ desired: [], events: [] });
    expect(persistedVisibilities).toEqual([true]);
  });

  it("allows a detected emitter to be its own Hide/Show target", async () => {
    const executor = new MechanicalEffectExecutor();
    const same = item("same", 0, 0);
    const ctx = visibilityContext(same, same, 0);
    const report = await executor.reconcile({ desired: [ctx], events: [] });
    expect(persistedVisibilities).toEqual([false]);
    expect(report.statuses.get(ctx.runtimeKey)).toBe("hidden");
  });
});

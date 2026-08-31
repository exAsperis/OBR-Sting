import type { Item } from "@owlbear-rodeo/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesiredEffect, MechanicalEffectDefinitionV1 } from "../../types";
import { fixedSharedAuthority } from "./authority";

const { startItemInteraction, updateItems, getItemBounds, addLocalItems, deleteLocalItems } = vi.hoisted(() => ({ startItemInteraction: vi.fn(), updateItems: vi.fn(), getItemBounds: vi.fn(), addLocalItems: vi.fn(), deleteLocalItems: vi.fn() }));
vi.mock("@owlbear-rodeo/sdk", () => ({
  buildLine: () => {
    const line: Record<string, unknown> = { id: crypto.randomUUID(), type: "LINE" };
    const builder: Record<string, unknown> = {};
    for (const method of ["name", "startPosition", "endPosition", "strokeColor", "strokeWidth", "locked", "disableHit", "disableAutoZIndex", "zIndex", "layer", "metadata"]) builder[method] = (value: unknown) => { line[method] = value; return builder; };
    builder.build = () => line;
    return builder;
  },
  default: { interaction: { startItemInteraction }, scene: { items: { updateItems, getItemBounds }, local: { addItems: addLocalItems, deleteItems: deleteLocalItems } } },
}));

import { MechanicalEffectExecutor } from "./executor";

const item = (id: string, x: number, y: number, rotation = 0): Item => ({
  id, type: "IMAGE", name: id, visible: true, locked: false, createdUserId: "gm", zIndex: 0,
  lastModified: "", lastModifiedUserId: "gm", position: { x, y }, rotation, scale: { x: 1, y: 1 }, metadata: {}, layer: "CHARACTER",
});
const effect: MechanicalEffectDefinitionV1 = { id: "face", type: "mechanical", enabled: true, action: "face", target: { type: "detector" }, faceAngle: 0, pivotX: 0, pivotY: 0, speed: 180 };
let updatedRotations: number[] = [];
let updatedPositions: Array<{ x: number; y: number }> = [];
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
    updatedPositions = [];
    persistedRotations = [];
    persistedVisibilities = [];
    getItemBounds.mockResolvedValue({ center: { x: 0, y: 0 }, width: 100, height: 100 });
    startItemInteraction.mockResolvedValue([(recipe: (draft: Item) => void) => { const draft = item("target", 0, 0); recipe(draft); updatedRotations.push(draft.rotation); updatedPositions.push({ ...draft.position }); return draft; }, vi.fn()]);
    updateItems.mockImplementation(async (_ids: string[], recipe: (drafts: Item[]) => void) => { const draft = item("target", 0, 0); recipe([draft]); persistedRotations.push(draft.rotation); persistedVisibilities.push(draft.visible); });
  });
  afterEach(() => vi.useRealTimers());

  it("only lets the GM start shared Face interactions", async () => {
    const target = item("target", 0, 0);
    const emitter = item("emitter", 10, 0);
    await new MechanicalEffectExecutor(fixedSharedAuthority(true)).reconcile({ desired: [context(target, emitter, 10, "PLAYER")], events: [] });
    expect(startItemInteraction).not.toHaveBeenCalled();
  });

  it("keeps a GM standby when the coordinator elects another healthy runtime", async () => {
    const target = item("target", 0, 0);
    const emitter = item("emitter", 10, 0);
    const losing = context(target, emitter, 10);
    const report = await new MechanicalEffectExecutor(fixedSharedAuthority(false)).reconcile({ desired: [losing], events: [] });
    expect(startItemInteraction).not.toHaveBeenCalled();
    expect(report.statuses.get(losing.runtimeKey)).toBe("authority-standby");
  });

  it("executes when the coordinator elects this GM session", async () => {
    const target = item("target", 0, 0);
    const winning = context(target, item("emitter", 10, 0), 10);
    const report = await new MechanicalEffectExecutor(fixedSharedAuthority(true)).reconcile({ desired: [winning], events: [] });
    expect(startItemInteraction).toHaveBeenCalledOnce();
    expect(report.statuses.get(winning.runtimeKey)).toBe("turning");
  });

  it("commits and stops an in-flight Face interaction when authority is lost", async () => {
    let active = true;
    const stop = vi.fn();
    const authority = {
      isAuthority: () => active,
      getSnapshot: () => ({ state: active ? "active" as const : "standby" as const, localConnectionId: "gm", leaderConnectionId: active ? "gm" : "other", healthyRuntimeCount: 2, selection: "automatic" as const, manualClaimedByLocal: false }),
    };
    startItemInteraction.mockResolvedValueOnce([(recipe: (draft: Item) => void) => { const draft = item("target", 0, 0); recipe(draft); return draft; }, stop]);
    const executor = new MechanicalEffectExecutor(authority);
    const desired = context(item("target", 0, 0), item("emitter", 10, 0), 10);
    await executor.reconcile({ desired: [desired], events: [] });
    active = false;
    const report = await executor.reconcile({ desired: [desired], events: [] });
    expect(stop).toHaveBeenCalledOnce();
    expect(updateItems).toHaveBeenCalled();
    expect(report.statuses.get(desired.runtimeKey)).toBe("authority-standby");
  });

  it("silently ignores a target that is its own detected emitter", async () => {
    const same = item("same", 0, 0);
    await new MechanicalEffectExecutor(fixedSharedAuthority(true)).reconcile({ desired: [context(same, same, 0)], events: [] });
    expect(startItemInteraction).not.toHaveBeenCalled();
  });

  it("shows a local crosshair at the resolved pivot and removes it when Face becomes inactive", async () => {
    const executor = new MechanicalEffectExecutor(fixedSharedAuthority(true));
    const ctx = context(item("target", 0, 0), item("emitter", 10, 0), 10);
    ctx.effect = { ...effect, pivotX: 200 };
    await executor.reconcile({ desired: [ctx], events: [] });
    expect(addLocalItems).toHaveBeenCalledOnce();
    const lines = addLocalItems.mock.calls[0][0] as Array<Record<string, { x: number; y: number }>>;
    expect(lines[0].startPosition).toEqual({ x: 88, y: 0 });
    expect(lines[0].endPosition).toEqual({ x: 112, y: 0 });
    await executor.reconcile({ desired: [], events: [] });
    expect(deleteLocalItems).toHaveBeenCalledOnce();
  });

  it("chooses the closest emitter when all-mode contexts share a target", async () => {
    const target = item("target", 0, 0);
    const near = context(target, item("near", 10, 0), 10, "GM", ["detector", "rule", "near-effect"]);
    const far = context(target, item("far", -20, 0), 20, "GM", ["detector", "rule", "far-effect"]);
    const report = await new MechanicalEffectExecutor(fixedSharedAuthority(true)).reconcile({ desired: [far, near], events: [] });
    expect(startItemInteraction).toHaveBeenCalledTimes(1);
    expect(report.statuses.get(near.runtimeKey)).toBe("turning");
    expect(report.statuses.get(far.runtimeKey)).toBe("superseded");
  });

  it("fails silently when Owlbear refuses to start an interaction", async () => {
    startItemInteraction.mockRejectedValueOnce(new Error("permission"));
    const ctx = context(item("target", 0, 0), item("emitter", 10, 0), 10);
    const report = await new MechanicalEffectExecutor(fixedSharedAuthority(true)).reconcile({ desired: [ctx], events: [] });
    expect(report.statuses.get(ctx.runtimeKey)).toBe("skipped");
  });

  it("advances rotations from background-safe timer ticks", async () => {
    const executor = new MechanicalEffectExecutor(fixedSharedAuthority(true));
    await executor.reconcile({ desired: [context(item("target", 0, 0), item("emitter", 10, 0), 10)], events: [] });
    await vi.advanceTimersByTimeAsync(250);
    expect(updatedRotations.at(-1)).toBeCloseTo(45, 0);
    await executor.clear();
  });

  it("moves Owlbear's native item origin around the configured pivot", async () => {
    const executor = new MechanicalEffectExecutor(fixedSharedAuthority(true));
    const ctx = context(item("target", 0, 0), item("emitter", 200, 0), 10);
    ctx.effect = { ...effect, pivotX: 200 };
    await executor.reconcile({ desired: [ctx], events: [] });
    await vi.advanceTimersByTimeAsync(500);
    expect(updatedRotations.at(-1)).toBe(90);
    expect(updatedPositions.at(-1)?.x).toBeCloseTo(100);
    expect(updatedPositions.at(-1)?.y).toBeCloseTo(-100);
  });

  it("persists the final rotation before ending the temporary interaction", async () => {
    const stop = vi.fn();
    startItemInteraction.mockResolvedValueOnce([(recipe: (draft: Item) => void) => { const draft = item("target", 0, 0); recipe(draft); return draft; }, stop]);
    const executor = new MechanicalEffectExecutor(fixedSharedAuthority(true));
    await executor.reconcile({ desired: [context(item("target", 0, 0), item("emitter", 10, 0), 10)], events: [] });
    await vi.advanceTimersByTimeAsync(500);
    expect(persistedRotations.at(-1)).toBe(90);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("hides on entry and reverses only after the final all-mode emitter exits", async () => {
    const executor = new MechanicalEffectExecutor(fixedSharedAuthority(true));
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
    const executor = new MechanicalEffectExecutor(fixedSharedAuthority(true));
    const ctx = visibilityContext(item("target", 0, 0), item("emitter", 10, 0), 10, "shown", false);
    await executor.reconcile({ desired: [ctx], events: [] });
    await executor.reconcile({ desired: [], events: [] });
    expect(persistedVisibilities).toEqual([true]);
  });

  it("allows a detected emitter to be its own Hide/Show target", async () => {
    const executor = new MechanicalEffectExecutor(fixedSharedAuthority(true));
    const same = item("same", 0, 0);
    const ctx = visibilityContext(same, same, 0);
    const report = await executor.reconcile({ desired: [ctx], events: [] });
    expect(persistedVisibilities).toEqual([false]);
    expect(report.statuses.get(ctx.runtimeKey)).toBe("hidden");
  });
});

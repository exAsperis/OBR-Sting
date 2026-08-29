import type { Item } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesiredEffect, MechanicalEffectDefinitionV1 } from "../../types";

const { startItemInteraction } = vi.hoisted(() => ({ startItemInteraction: vi.fn() }));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: { interaction: { startItemInteraction } } }));

import { MechanicalEffectExecutor } from "./executor";

const item = (id: string, x: number, y: number, rotation = 0): Item => ({
  id, type: "IMAGE", name: id, visible: true, locked: false, createdUserId: "gm", zIndex: 0,
  lastModified: "", lastModifiedUserId: "gm", position: { x, y }, rotation, scale: { x: 1, y: 1 }, metadata: {}, layer: "CHARACTER",
});
const effect: MechanicalEffectDefinitionV1 = { id: "face", type: "mechanical", enabled: true, action: "face", target: { type: "detector" }, faceAngle: 0, speed: 180 };
function context(target: Item, emitter: Item, distance: number, role: "GM" | "PLAYER" = "GM", ids = ["detector", "rule", "face"]): DesiredEffect {
  return {
    effect: { ...effect, id: ids[2] }, runtimeKey: ids.join("/"), target, detectedEmitter: emitter, distance,
    detector: item(ids[0], 0, 0), rule: { id: ids[1] }, localPlayer: { id: role.toLowerCase(), role, connectionId: `${role}-1` }, party: [],
    audienceMatch: role === "GM",
  } as unknown as DesiredEffect;
}

describe("MechanicalEffectExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startItemInteraction.mockResolvedValue([(recipe: (draft: Item) => void) => { const draft = item("target", 0, 0); recipe(draft); return draft; }, vi.fn()]);
  });

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
      { id: "gm", role: "GM", connectionId: "gm-b" },
      { id: "gm", role: "GM", connectionId: "gm-a" },
    ] as DesiredEffect["party"];
    const report = await new MechanicalEffectExecutor().reconcile({ desired: [losing], events: [] });
    expect(startItemInteraction).not.toHaveBeenCalled();
    expect(report.statuses.get(losing.runtimeKey)).toBe("authority-standby");
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
});

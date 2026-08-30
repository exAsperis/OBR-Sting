import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item, Player } from "@owlbear-rodeo/sdk";
import { RUMBLE_INTEGRATION_KEY } from "../../../../constants";
import type { AttachmentGraph, DesiredEffect, EffectAudienceV1, IntegrationEffectDefinitionV1 } from "../../../../types";
import { RUMBLE_CHAT_KEY, RUMBLE_DICE_KEY, RumbleProvider } from "./provider";

const { getMetadata, setMetadata } = vi.hoisted(() => ({ getMetadata: vi.fn(), setMetadata: vi.fn() }));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: { scene: { getMetadata }, player: { setMetadata } } }));

const item = (id: string, owner = "owner") => ({ id, name: id, createdUserId: owner, position: { x: 0, y: 0 }, metadata: {} }) as Item;
const player = (id: string, role: "GM" | "PLAYER" = "PLAYER", connectionId = id) => ({ id, role, connectionId, name: id }) as Player;
const graph = (items: Item[]): AttachmentGraph => ({ byId: new Map(items.map((entry) => [entry.id, entry])), rootById: new Map(items.map((entry) => [entry.id, entry.id])), childrenById: new Map() });

function context(actionId: "send-message" | "roll-dice", audience: EffectAudienceV1 = { type: "everyone" }): DesiredEffect {
  const detector = item("detector", "detector-owner");
  const target = item("target", "target-owner");
  const effect: IntegrationEffectDefinitionV1 = {
    id: "effect", type: "integration", enabled: true, lifecycle: "enter", target: { type: "detector" }, audience,
    providerId: "rumble", providerSchemaVersion: 1, actionId,
    parameters: actionId === "send-message" ? { message: "Danger nearby" } : { notation: "2d10" },
  };
  return {
    effect, runtimeKey: `rumble/${actionId}`, detector, target, detectedEmitter: item("emitter"), rule: {} as DesiredEffect["rule"],
    matchingEmitterCount: 1, distance: 1, strength: 1, localPlayer: player("gm", "GM", "gm-a"),
    party: [player("player-a"), player("player-b")], graph: graph([detector, target]),
    current: { active: true, strength: 1, distance: 1, detectedEmitterId: "emitter" }, previous: null,
    transition: { type: "enter" }, audienceMatch: true,
  };
}

describe("RumbleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMetadata.mockResolvedValue({ [RUMBLE_INTEGRATION_KEY]: true });
    setMetadata.mockResolvedValue(undefined);
  });

  it("sends one documented party chat payload", async () => {
    const report = await new RumbleProvider().reconcile({ desired: [], events: [context("send-message")] });
    expect(setMetadata).toHaveBeenCalledOnce();
    expect(setMetadata.mock.calls[0][0][RUMBLE_CHAT_KEY]).toMatchObject({ chatlog: "Danger nearby", sender: "Sting", targetId: "0000" });
    expect(report.statuses.get("rumble/send-message")).toBe("sent:1");
  });

  it("deduplicates and sequentially sends direct recipients", async () => {
    const ctx = context("send-message", { type: "specific-users", userIds: ["player-a", "player-a", "offline"] });
    const report = await new RumbleProvider().reconcile({ desired: [], events: [ctx] });
    expect(setMetadata.mock.calls.map((call) => call[0][RUMBLE_CHAT_KEY].targetId)).toEqual(["player-a", "offline"]);
    expect(report.statuses.get(ctx.runtimeKey)).toBe("sent:2");
  });

  it("reports no recipients without writing metadata", async () => {
    const ctx = context("send-message", { type: "specific-users", userIds: [] });
    const report = await new RumbleProvider().reconcile({ desired: [], events: [ctx] });
    expect(setMetadata).not.toHaveBeenCalled();
    expect(report.statuses.get(ctx.runtimeKey)).toBe("no-recipients");
  });

  it("isolates a failed direct recipient and continues", async () => {
    setMetadata.mockRejectedValueOnce(new Error("first failed")).mockResolvedValueOnce(undefined);
    const ctx = context("send-message", { type: "specific-users", userIds: ["one", "two"] });
    const report = await new RumbleProvider().reconcile({ desired: [], events: [ctx] });
    expect(setMetadata).toHaveBeenCalledTimes(2);
    expect(report.statuses.get(ctx.runtimeKey)).toMatch(/^partial-error: sent 1\/2/);
  });

  it("writes the documented party dice payload", async () => {
    const report = await new RumbleProvider().reconcile({ desired: [], events: [context("roll-dice")] });
    expect(setMetadata.mock.calls[0][0][RUMBLE_DICE_KEY]).toMatchObject({ notation: "2d10", sender: "Sting" });
    expect(report.statuses.get("rumble/roll-dice")).toBe("rolled");
  });

  it("rejects unsupported lifecycles, schemas, and targeted dice", () => {
    const provider = new RumbleProvider();
    const base = context("roll-dice").effect as IntegrationEffectDefinitionV1;
    expect(provider.validate({ ...base, lifecycle: "continuous" })).toContain("Unsupported lifecycle.");
    expect(provider.validate({ ...base, providerSchemaVersion: 2 })).toContain("Unsupported provider schema version.");
    expect(provider.validate({ ...base, audience: { type: "gm" } })).toContain("Rumble! dice rolls support the Everyone audience only.");
  });

  it("skips all commands while disabled", async () => {
    getMetadata.mockResolvedValue({ [RUMBLE_INTEGRATION_KEY]: false });
    const ctx = context("send-message");
    const report = await new RumbleProvider().reconcile({ desired: [], events: [ctx] });
    expect(setMetadata).not.toHaveBeenCalled();
    expect(report.statuses.get(ctx.runtimeKey)).toBe("provider-unavailable");
  });
});

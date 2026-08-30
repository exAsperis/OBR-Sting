import { describe, expect, it } from "vitest";
import type { Item, Player } from "@owlbear-rodeo/sdk";
import { resolveAudienceUserIds } from "./resolve";
import type { AttachmentGraph, EffectAudienceV1 } from "../types";

const item = (id: string, owner?: string, attachedTo?: string) => ({ id, name: id, createdUserId: owner ?? "", attachedTo, metadata: {} }) as Item;
const players = [
  { id: "gm", role: "GM" },
  { id: "player-a", role: "PLAYER" },
  { id: "player-b", role: "PLAYER" },
] as Player[];
const carrier = item("carrier", "carrier-owner");
const detector = item("detector", "detector-owner", carrier.id);
const target = item("target", "target-owner");
const graph: AttachmentGraph = {
  byId: new Map([[carrier.id, carrier], [detector.id, detector], [target.id, target]]),
  rootById: new Map([[carrier.id, carrier.id], [detector.id, carrier.id], [target.id, target.id]]),
  childrenById: new Map([[carrier.id, [detector]]]),
};

describe("resolveAudienceUserIds", () => {
  it.each<[EffectAudienceV1, string[]]>([
    [{ type: "everyone" }, ["gm", "player-a", "player-b"]],
    [{ type: "gm" }, ["gm"]],
    [{ type: "players" }, ["player-a", "player-b"]],
    [{ type: "detector-owner" }, ["detector-owner"]],
    [{ type: "carrier-owner" }, ["carrier-owner"]],
    [{ type: "target-owner" }, ["target-owner"]],
    [{ type: "specific-users", userIds: ["player-a", "player-a", "offline"] }, ["player-a", "offline"]],
  ])("resolves %j", (audience, expected) => {
    expect(resolveAudienceUserIds(audience, players, detector, target, graph)).toEqual(expected);
  });

  it("returns no ID for an unresolved owner", () => {
    expect(resolveAudienceUserIds({ type: "target-owner" }, players, detector, null, graph)).toEqual([]);
  });
});

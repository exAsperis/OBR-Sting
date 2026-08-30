import type { Item, Player } from "@owlbear-rodeo/sdk";
import type { AttachmentGraph, EffectAudienceV1, EffectTargetV1 } from "../types";
import { resolveCarrier, resolveParent } from "./attachments";

export function resolveEffectTarget(
  target: EffectTargetV1,
  detector: Item,
  detectedEmitter: Item | null,
  graph: AttachmentGraph,
): Item | null {
  switch (target.type) {
    case "detector": return detector;
    case "parent": return resolveParent(detector, graph);
    case "carrier": return resolveCarrier(detector, graph);
    case "detected-emitter": return detectedEmitter;
    case "specific-item": return graph.byId.get(target.itemId) ?? null;
  }
}

export function resolveItemOwnerId(item: Item | null): string | null {
  return item?.createdUserId || null;
}

export function isAudienceMember(
  audience: EffectAudienceV1,
  localPlayer: Pick<Player, "id" | "role">,
  detector: Item,
  target: Item | null,
  graph: AttachmentGraph,
): boolean {
  switch (audience.type) {
    case "everyone": return true;
    case "gm": return localPlayer.role === "GM";
    case "players": return localPlayer.role === "PLAYER";
    case "detector-owner": return resolveItemOwnerId(detector) === localPlayer.id;
    case "carrier-owner": return resolveItemOwnerId(resolveCarrier(detector, graph)) === localPlayer.id;
    case "target-owner": return resolveItemOwnerId(target) === localPlayer.id;
    case "specific-users": return audience.userIds.includes(localPlayer.id);
  }
}

/** Resolve an integration audience to stable Owlbear user IDs. */
export function resolveAudienceUserIds(
  audience: EffectAudienceV1,
  party: Pick<Player, "id" | "role">[],
  detector: Item,
  target: Item | null,
  graph: AttachmentGraph,
): string[] {
  let ids: Array<string | null>;
  switch (audience.type) {
    case "everyone": ids = party.map((player) => player.id); break;
    case "gm": ids = party.filter((player) => player.role === "GM").map((player) => player.id); break;
    case "players": ids = party.filter((player) => player.role === "PLAYER").map((player) => player.id); break;
    case "detector-owner": ids = [resolveItemOwnerId(detector)]; break;
    case "carrier-owner": ids = [resolveItemOwnerId(resolveCarrier(detector, graph))]; break;
    case "target-owner": ids = [resolveItemOwnerId(target)]; break;
    case "specific-users": ids = audience.userIds; break;
  }
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function isShaderAudienceMember(
  audience: EffectAudienceV1,
  alwaysIncludeGm: boolean,
  localPlayer: Pick<Player, "id" | "role">,
  detector: Item,
  target: Item | null,
  graph: AttachmentGraph,
): boolean {
  return (alwaysIncludeGm && localPlayer.role === "GM") || isAudienceMember(audience, localPlayer, detector, target, graph);
}

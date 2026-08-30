import type { Player } from "@owlbear-rodeo/sdk";

type MechanicalPlayer = Pick<Player, "id" | "role" | "connectionId">;

/** Elect one connected GM session as the shared writer for mechanical effects. */
export function isMechanicalAuthority(localPlayer: MechanicalPlayer, party: Player[]): boolean {
  if (localPlayer.role !== "GM") return false;
  // OBR.party intentionally excludes the local player. Include it explicitly so
  // every session elects from the same complete set of connected GM sessions.
  const gmConnections = [localPlayer, ...party]
    .filter((player) => player.role === "GM")
    .map((player) => player.connectionId)
    .filter((connectionId, index, all) => all.indexOf(connectionId) === index)
    .sort();
  return gmConnections[0] === localPlayer.connectionId;
}

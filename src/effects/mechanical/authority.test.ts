import type { Player } from "@owlbear-rodeo/sdk";
import { describe, expect, it } from "vitest";
import { isMechanicalAuthority } from "./authority";

const player = (connectionId: string, role: "GM" | "PLAYER" = "GM") => ({ id: role.toLowerCase(), role, connectionId }) as Player;

describe("mechanical effect authority", () => {
  it("elects the only GM session", () => {
    expect(isMechanicalAuthority(player("gm-a"), [])).toBe(true);
  });

  it("includes the local session because OBR.party only contains other players", () => {
    expect(isMechanicalAuthority(player("gm-a"), [player("gm-b")])).toBe(true);
    expect(isMechanicalAuthority(player("gm-b"), [player("gm-a")])).toBe(false);
  });

  it("never elects a player session", () => {
    expect(isMechanicalAuthority(player("player", "PLAYER"), [player("gm")])).toBe(false);
  });
});

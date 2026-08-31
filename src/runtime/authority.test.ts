import type { Player } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTHORITY_CONTROL_CHANNEL, AUTHORITY_PRESENCE_CHANNEL } from "../constants";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { data: unknown; connectionId: string }) => void>(),
  metadataHandler: undefined as undefined | ((metadata: Record<string, unknown>) => void),
  sendMessage: vi.fn(async () => undefined),
  getMetadata: vi.fn(async () => ({})),
  setMetadata: vi.fn(async () => undefined),
  setBadgeText: vi.fn(async () => undefined),
  setBadgeBackgroundColor: vi.fn(async () => undefined),
}));

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    broadcast: {
      onMessage: (channel: string, handler: (event: { data: unknown; connectionId: string }) => void) => { mocks.handlers.set(channel, handler); return () => mocks.handlers.delete(channel); },
      sendMessage: mocks.sendMessage,
    },
    room: {
      getMetadata: mocks.getMetadata,
      setMetadata: mocks.setMetadata,
      onMetadataChange: (handler: (metadata: Record<string, unknown>) => void) => { mocks.metadataHandler = handler; return () => { mocks.metadataHandler = undefined; }; },
    },
    action: { setBadgeText: mocks.setBadgeText, setBadgeBackgroundColor: mocks.setBadgeBackgroundColor },
  },
}));

import { applyAuthorityBadge, AuthorityCoordinator, parseAuthorityControl, parseAuthorityStatus } from "./authority";

const player = (connectionId: string, role: "GM" | "PLAYER" = "GM") => ({ id: connectionId, connectionId, role, name: connectionId }) as Player;

describe("AuthorityCoordinator", () => {
  let now: number;

  beforeEach(() => {
    now = 10_000;
    mocks.handlers.clear();
    mocks.metadataHandler = undefined;
    vi.clearAllMocks();
    mocks.getMetadata.mockResolvedValue({});
  });

  const coordinator = (local = player("gm-b"), party = [player("gm-a")]) => new AuthorityCoordinator(local, party, {
    now: () => now,
    disableTimer: true,
    discoveryMs: 1_000,
    expiresMs: 8_000,
  });

  const deliver = (channel: string, connectionId: string, data: unknown) => mocks.handlers.get(channel)?.({ connectionId, data });

  it("discovers compatible GM runtimes and deterministically elects one", async () => {
    const runtime = coordinator();
    await runtime.start();
    expect(runtime.getSnapshot().state).toBe("discovering");
    deliver(AUTHORITY_PRESENCE_CHANNEL, "gm-a", { version: 1, type: "hello" });
    now += 1_000;
    runtime.tick(1_000);
    expect(runtime.getSnapshot()).toMatchObject({ state: "standby", leaderConnectionId: "gm-a", healthyRuntimeCount: 2, selection: "automatic" });
    await runtime.stop();
  });

  it("ignores malformed, player, and unknown-sender heartbeats", async () => {
    const runtime = coordinator(player("gm-b"), [player("player", "PLAYER"), player("gm-a")]);
    await runtime.start();
    deliver(AUTHORITY_PRESENCE_CHANNEL, "player", { version: 1, type: "presence" });
    deliver(AUTHORITY_PRESENCE_CHANNEL, "unknown", { version: 1, type: "presence" });
    deliver(AUTHORITY_PRESENCE_CHANNEL, "gm-a", { version: 2, type: "presence" });
    now += 1_000;
    runtime.tick(1_000);
    expect(runtime.getSnapshot()).toMatchObject({ state: "active", leaderConnectionId: "gm-b", healthyRuntimeCount: 1 });
  });

  it("fails over after a healthy peer misses the eight-second lease", async () => {
    const runtime = coordinator();
    await runtime.start();
    deliver(AUTHORITY_PRESENCE_CHANNEL, "gm-a", { version: 1, type: "presence" });
    now += 1_000;
    runtime.tick(1_000);
    expect(runtime.isAuthority()).toBe(false);
    now += 8_001;
    runtime.tick(8_001);
    expect(runtime.getSnapshot()).toMatchObject({ state: "active", leaderConnectionId: "gm-b", healthyRuntimeCount: 1 });
  });

  it("honors a live manual claim and ignores the same claim after it becomes stale", async () => {
    const runtime = coordinator();
    await runtime.start();
    deliver(AUTHORITY_PRESENCE_CHANNEL, "gm-a", { version: 1, type: "presence" });
    runtime.setRoomMetadata({ "com.ex-asperis.sting/authority-override": { version: 1, connectionId: "gm-b", claimId: "claim" } });
    now += 1_000;
    runtime.tick(1_000);
    expect(runtime.getSnapshot()).toMatchObject({ state: "active", selection: "manual", manualClaimedByLocal: true });
    runtime.setRoomMetadata({ "com.ex-asperis.sting/authority-override": { version: 1, connectionId: "missing", claimId: "stale" } });
    expect(runtime.getSnapshot()).toMatchObject({ state: "standby", selection: "automatic", leaderConnectionId: "gm-a" });
  });

  it("writes and releases a connection-scoped claim through validated local controls", async () => {
    const runtime = coordinator(player("gm-b"), []);
    await runtime.start();
    now += 1_000;
    runtime.tick(1_000);
    deliver(AUTHORITY_CONTROL_CHANNEL, "gm-b", { version: 1, type: "take-control", requestId: "take" });
    await vi.waitFor(() => expect(mocks.setMetadata).toHaveBeenCalled());
    const calls = mocks.setMetadata.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls.at(-1)?.[0]).toMatchObject({ "com.ex-asperis.sting/authority-override": { version: 1, connectionId: "gm-b" } });
    expect(runtime.getSnapshot().manualClaimedByLocal).toBe(true);
    deliver(AUTHORITY_CONTROL_CHANNEL, "gm-b", { version: 1, type: "release-control", requestId: "release" });
    await vi.waitFor(() => expect(mocks.setMetadata).toHaveBeenCalledTimes(2));
    expect(calls.at(-1)?.[0]).toMatchObject({ "com.ex-asperis.sting/authority-override": { version: 1, connectionId: null } });
    expect(runtime.getSnapshot().selection).toBe("automatic");
  });

  it("never makes a player runtime eligible", async () => {
    const runtime = coordinator(player("player", "PLAYER"), [player("gm-a")]);
    await runtime.start();
    now += 2_000;
    runtime.tick(2_000);
    expect(runtime.getSnapshot()).toMatchObject({ state: "ineligible", leaderConnectionId: null, healthyRuntimeCount: 0 });
  });
});

describe("authority protocol parsers", () => {
  it("rejects malformed controls and status payloads", () => {
    expect(parseAuthorityControl({ version: 1, type: "take-control" })).toBeNull();
    expect(parseAuthorityStatus({ version: 1, type: "authority-status", snapshot: { state: "root" } })).toBeNull();
  });

  it("shows an amber STBY badge only for standby", async () => {
    const snapshot = { state: "standby", localConnectionId: "gm-b", leaderConnectionId: "gm-a", healthyRuntimeCount: 2, selection: "automatic", manualClaimedByLocal: false } as const;
    await applyAuthorityBadge(snapshot);
    expect(mocks.setBadgeText).toHaveBeenLastCalledWith("STBY");
    expect(mocks.setBadgeBackgroundColor).toHaveBeenLastCalledWith("#d97706");
    await applyAuthorityBadge({ ...snapshot, state: "active", leaderConnectionId: "gm-b" });
    expect(mocks.setBadgeText).toHaveBeenLastCalledWith(undefined);
  });
});

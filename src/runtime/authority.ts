import OBR, { type Metadata, type Player } from "@owlbear-rodeo/sdk";
import {
  AUTHORITY_CONTROL_CHANNEL,
  AUTHORITY_OVERRIDE_KEY,
  AUTHORITY_PRESENCE_CHANNEL,
  AUTHORITY_STATUS_CHANNEL,
} from "../constants";
import type { SharedAuthoritySnapshot, SharedEffectAuthority } from "../effects/mechanical/authority";

const PROTOCOL_VERSION = 1;
const DISCOVERY_MS = 1_000;
const HEARTBEAT_MS = 2_000;
const WATCHDOG_MS = 1_000;
const EXPIRES_MS = 8_000;

type PresenceMessage = { version: 1; type: "hello" | "presence" | "goodbye" };
export type AuthorityControlMessage = {
  version: 1;
  type: "request-status" | "take-control" | "release-control";
  requestId: string;
};
export type AuthorityStatusMessage = {
  version: 1;
  type: "authority-status";
  requestId?: string;
  error?: string;
  snapshot: SharedAuthoritySnapshot;
};

interface AuthorityOverrideV1 {
  version: 1;
  connectionId: string | null;
  claimId: string;
}

interface AuthorityCoordinatorOptions {
  now?: () => number;
  discoveryMs?: number;
  expiresMs?: number;
  disableTimer?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePresence(value: unknown): PresenceMessage | null {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION) return null;
  if (value.type !== "hello" && value.type !== "presence" && value.type !== "goodbye") return null;
  return { version: 1, type: value.type };
}

export function parseAuthorityControl(value: unknown): AuthorityControlMessage | null {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || typeof value.requestId !== "string") return null;
  if (value.type !== "request-status" && value.type !== "take-control" && value.type !== "release-control") return null;
  return { version: 1, type: value.type, requestId: value.requestId };
}

export function parseAuthorityStatus(value: unknown): AuthorityStatusMessage | null {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || value.type !== "authority-status" || !isRecord(value.snapshot)) return null;
  const snapshot = value.snapshot;
  if (snapshot.state !== "discovering" && snapshot.state !== "active" && snapshot.state !== "standby" && snapshot.state !== "ineligible") return null;
  if (typeof snapshot.localConnectionId !== "string" || (snapshot.leaderConnectionId !== null && typeof snapshot.leaderConnectionId !== "string")) return null;
  if (typeof snapshot.healthyRuntimeCount !== "number" || (snapshot.selection !== "automatic" && snapshot.selection !== "manual") || typeof snapshot.manualClaimedByLocal !== "boolean") return null;
  return {
    version: 1,
    type: "authority-status",
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    snapshot: snapshot as unknown as SharedAuthoritySnapshot,
  };
}

function parseOverride(value: unknown): AuthorityOverrideV1 | null {
  if (!isRecord(value) || value.version !== 1 || (value.connectionId !== null && typeof value.connectionId !== "string") || typeof value.claimId !== "string") return null;
  return { version: 1, connectionId: value.connectionId, claimId: value.claimId };
}

const sameSnapshot = (left: SharedAuthoritySnapshot, right: SharedAuthoritySnapshot) =>
  left.state === right.state &&
  left.localConnectionId === right.localConnectionId &&
  left.leaderConnectionId === right.leaderConnectionId &&
  left.healthyRuntimeCount === right.healthyRuntimeCount &&
  left.selection === right.selection &&
  left.manualClaimedByLocal === right.manualClaimedByLocal;

export class AuthorityCoordinator implements SharedEffectAuthority {
  private readonly now: () => number;
  private readonly discoveryMs: number;
  private readonly expiresMs: number;
  private localPlayer: Pick<Player, "id" | "role" | "connectionId">;
  private party: Player[];
  private peers = new Map<string, number>();
  private override: AuthorityOverrideV1 | null = null;
  private startedAt: number;
  private snapshot: SharedAuthoritySnapshot;
  private listeners = new Set<(snapshot: SharedAuthoritySnapshot) => void>();
  private stopPresence?: () => void;
  private stopControl?: () => void;
  private stopMetadata?: () => void;
  private tickerWorker: Worker | null = null;
  private tickerTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatElapsed = HEARTBEAT_MS;

  constructor(localPlayer: Pick<Player, "id" | "role" | "connectionId">, party: Player[], options: AuthorityCoordinatorOptions = {}) {
    this.localPlayer = localPlayer;
    this.party = party;
    this.now = options.now ?? Date.now;
    this.discoveryMs = options.discoveryMs ?? DISCOVERY_MS;
    this.expiresMs = options.expiresMs ?? EXPIRES_MS;
    this.startedAt = this.now();
    this.snapshot = this.deriveSnapshot();
    if (!options.disableTimer) this.startTicker();
  }

  async start(): Promise<void> {
    this.stopPresence = OBR.broadcast.onMessage(AUTHORITY_PRESENCE_CHANNEL, (event) => {
      const message = parsePresence(event.data);
      if (!message || event.connectionId === this.localPlayer.connectionId || !this.isConnectedRemoteGm(event.connectionId)) return;
      if (message.type === "goodbye") this.peers.delete(event.connectionId);
      else this.peers.set(event.connectionId, this.now());
      if (message.type === "hello") void this.sendPresence("presence");
      this.recompute();
    });
    this.stopControl = OBR.broadcast.onMessage(AUTHORITY_CONTROL_CHANNEL, (event) => {
      const message = parseAuthorityControl(event.data);
      if (!message || event.connectionId !== this.localPlayer.connectionId) return;
      void this.handleControl(message);
    });
    this.stopMetadata = OBR.room.onMetadataChange((metadata) => this.setRoomMetadata(metadata));
    try { this.setRoomMetadata(await OBR.room.getMetadata()); }
    catch { this.override = null; }
    await this.sendPresence("hello");
    this.recompute();
  }

  isAuthority(): boolean { return this.snapshot.state === "active"; }
  getSnapshot(): SharedAuthoritySnapshot { return { ...this.snapshot }; }

  subscribe(listener: (snapshot: SharedAuthoritySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  setPlayer(player: Pick<Player, "id" | "role" | "connectionId">): void {
    const connectionChanged = player.connectionId !== this.localPlayer.connectionId;
    this.localPlayer = player;
    if (connectionChanged) {
      this.peers.clear();
      this.startedAt = this.now();
      void this.sendPresence("hello");
    }
    this.recompute();
  }

  setParty(party: Player[]): void {
    this.party = party;
    for (const connectionId of this.peers.keys()) if (!this.isConnectedRemoteGm(connectionId)) this.peers.delete(connectionId);
    this.recompute();
  }

  setRoomMetadata(metadata: Metadata): void {
    this.override = parseOverride(metadata[AUTHORITY_OVERRIDE_KEY]);
    this.recompute();
  }

  /** Public for fake-timer tests; production calls this from the worker-backed watchdog. */
  tick(elapsedMs = WATCHDOG_MS): void {
    this.heartbeatElapsed += elapsedMs;
    if (this.heartbeatElapsed >= HEARTBEAT_MS) {
      this.heartbeatElapsed = 0;
      void this.sendPresence("presence");
    }
    this.pruneExpired();
    this.recompute();
  }

  async stop(): Promise<void> {
    await this.sendPresence("goodbye");
    this.stopPresence?.();
    this.stopControl?.();
    this.stopMetadata?.();
    this.stopPresence = undefined;
    this.stopControl = undefined;
    this.stopMetadata = undefined;
    this.tickerWorker?.terminate();
    this.tickerWorker = null;
    if (this.tickerTimer !== null) clearInterval(this.tickerTimer);
    this.tickerTimer = null;
    this.listeners.clear();
  }

  private async handleControl(message: AuthorityControlMessage): Promise<void> {
    if (message.type === "request-status") {
      await this.publishStatus(message.requestId);
      return;
    }
    if (this.localPlayer.role !== "GM") {
      await this.publishStatus(message.requestId, "Only a GM session can control shared-effect authority.");
      return;
    }
    const next: AuthorityOverrideV1 = {
      version: 1,
      connectionId: message.type === "take-control" ? this.localPlayer.connectionId : null,
      claimId: crypto.randomUUID(),
    };
    try {
      await OBR.room.setMetadata({ [AUTHORITY_OVERRIDE_KEY]: next });
      this.override = next;
      this.recompute();
      await this.publishStatus(message.requestId);
    } catch {
      await this.publishStatus(message.requestId, "Unable to update the room authority. Check the room connection and try again.");
    }
  }

  private async publishStatus(requestId?: string, error?: string): Promise<void> {
    const message: AuthorityStatusMessage = {
      version: 1,
      type: "authority-status",
      snapshot: this.getSnapshot(),
      ...(requestId ? { requestId } : {}),
      ...(error ? { error } : {}),
    };
    try { await OBR.broadcast.sendMessage(AUTHORITY_STATUS_CHANNEL, message, { destination: "LOCAL" }); }
    catch { /* status is refreshed by the next request or authority transition */ }
  }

  private async sendPresence(type: PresenceMessage["type"]): Promise<void> {
    if (this.localPlayer.role !== "GM") return;
    try {
      await OBR.broadcast.sendMessage(AUTHORITY_PRESENCE_CHANNEL, { version: 1, type } satisfies PresenceMessage, { destination: "REMOTE" });
    } catch { /* the next heartbeat retries */ }
  }

  private isConnectedRemoteGm(connectionId: string): boolean {
    return this.party.some((player) => player.connectionId === connectionId && player.role === "GM");
  }

  private healthyCandidates(): string[] {
    const now = this.now();
    const candidates = this.localPlayer.role === "GM" ? [this.localPlayer.connectionId] : [];
    for (const [connectionId, lastSeen] of this.peers) {
      if (now - lastSeen <= this.expiresMs && this.isConnectedRemoteGm(connectionId)) candidates.push(connectionId);
    }
    return [...new Set(candidates)].sort();
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [connectionId, lastSeen] of this.peers) if (now - lastSeen > this.expiresMs) this.peers.delete(connectionId);
  }

  private deriveSnapshot(): SharedAuthoritySnapshot {
    const candidates = this.healthyCandidates();
    const manualLeader = this.override?.connectionId && candidates.includes(this.override.connectionId) ? this.override.connectionId : null;
    const leaderConnectionId = manualLeader ?? candidates[0] ?? null;
    const state = this.localPlayer.role !== "GM"
      ? "ineligible"
      : this.now() - this.startedAt < this.discoveryMs
        ? "discovering"
        : leaderConnectionId === this.localPlayer.connectionId ? "active" : "standby";
    return {
      state,
      localConnectionId: this.localPlayer.connectionId,
      leaderConnectionId,
      healthyRuntimeCount: candidates.length,
      selection: manualLeader ? "manual" : "automatic",
      manualClaimedByLocal: manualLeader === this.localPlayer.connectionId,
    };
  }

  private recompute(): void {
    const next = this.deriveSnapshot();
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener(this.getSnapshot());
    void this.publishStatus();
  }

  private startTicker(): void {
    if (typeof Worker !== "undefined" && typeof Blob !== "undefined") {
      try {
        const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(${WATCHDOG_MS}), ${WATCHDOG_MS});`], { type: "text/javascript" }));
        this.tickerWorker = new Worker(url);
        URL.revokeObjectURL(url);
        this.tickerWorker.onmessage = () => this.tick(WATCHDOG_MS);
        return;
      } catch { /* use the interval fallback */ }
    }
    this.tickerTimer = setInterval(() => this.tick(WATCHDOG_MS), WATCHDOG_MS);
  }
}

/** Keep action-bar authority feedback local to this Owlbear connection. */
export async function applyAuthorityBadge(snapshot: SharedAuthoritySnapshot): Promise<void> {
  const standby = snapshot.state === "standby";
  await OBR.action.setBadgeText(standby ? "STBY" : undefined);
  if (standby) await OBR.action.setBadgeBackgroundColor("#d97706");
}

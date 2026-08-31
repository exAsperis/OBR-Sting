export type SharedAuthorityState = "discovering" | "active" | "standby" | "ineligible";

export interface SharedAuthoritySnapshot {
  state: SharedAuthorityState;
  localConnectionId: string;
  leaderConnectionId: string | null;
  healthyRuntimeCount: number;
  selection: "automatic" | "manual";
  manualClaimedByLocal: boolean;
}

/** Read-only authority surface shared by every room-wide effect executor. */
export interface SharedEffectAuthority {
  isAuthority(): boolean;
  getSnapshot(): SharedAuthoritySnapshot;
}

/** Small deterministic authority used by isolated executor tests. */
export function fixedSharedAuthority(active: boolean): SharedEffectAuthority {
  const state = active ? "active" : "standby";
  return {
    isAuthority: () => active,
    getSnapshot: () => ({
      state,
      localConnectionId: "test-local",
      leaderConnectionId: active ? "test-local" : "test-remote",
      healthyRuntimeCount: active ? 1 : 2,
      selection: "automatic",
      manualClaimedByLocal: false,
    }),
  };
}

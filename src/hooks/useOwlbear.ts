import OBR from "@owlbear-rodeo/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyOwlbearTheme } from "../theme";

export type ConnectionStatus = "connecting" | "ready" | "error";

export interface OwlbearState {
  status: ConnectionStatus;
  role: "GM" | "PLAYER" | null;
  playerName: string | null;
  sceneReady: boolean;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useOwlbear(): OwlbearState {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [role, setRole] = useState<"GM" | "PLAYER" | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);

  const refresh = useCallback(async () => {
    if (!active.current) return;
    setRefreshing(true);
    try {
      const [nextRole, nextName, nextSceneReady] = await Promise.all([
        OBR.player.getRole(),
        OBR.player.getName(),
        OBR.scene.isReady(),
      ]);
      if (!active.current) return;
      setRole(nextRole);
      setPlayerName(nextName);
      setSceneReady(nextSceneReady);
      setError(null);
      setStatus("ready");
    } catch (cause) {
      if (!active.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to read Owlbear Rodeo state.");
      setStatus("error");
    } finally {
      if (active.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    let cleanupTheme: (() => void) | undefined;
    let cleanupPlayer: (() => void) | undefined;
    let cleanupScene: (() => void) | undefined;
    let sdkReady = false;

    const timeout = window.setTimeout(() => {
      if (!active.current || sdkReady) return;
      setError("The Owlbear SDK did not become ready. Open this page as an extension inside a room.");
      setStatus("error");
    }, 8_000);

    if (window.self === window.top) {
      window.clearTimeout(timeout);
      setError("Open this extension inside an Owlbear Rodeo room.");
      setStatus("error");
      return () => { active.current = false; };
    }

    OBR.onReady(async () => {
      if (!active.current) return;
      sdkReady = true;
      window.clearTimeout(timeout);
      try {
        applyOwlbearTheme(await OBR.theme.getTheme());
        cleanupTheme = OBR.theme.onChange(applyOwlbearTheme);
      } catch {
        // CSS fallbacks keep the extension usable if theme access fails.
      }

      cleanupPlayer = OBR.player.onChange(() => void refresh());
      cleanupScene = OBR.scene.onReadyChange(() => void refresh());
      await refresh();
    });

    return () => {
      active.current = false;
      window.clearTimeout(timeout);
      cleanupTheme?.();
      cleanupPlayer?.();
      cleanupScene?.();
    };
  }, [refresh]);

  return { status, role, playerName, sceneReady, error, refreshing, refresh };
}

import OBR from "@owlbear-rodeo/sdk";
import { CONTEXT_MENU_ID, EMANATION_INTEGRATION_KEY, SETTINGS_KEY } from "../constants";
import { ProximityEngine } from "./engine";
import { parseSceneSettings } from "../settings";
import { clearSelectedFacePivots, syncSelectedFacePivots } from "./pivotDebug";
import { applyAuthorityBadge, AuthorityCoordinator } from "./authority";

OBR.onReady(async () => {
  const [role, connectionId, initialParty] = await Promise.all([OBR.player.getRole(), OBR.player.getConnectionId(), OBR.party.getPlayers()]);
  const initialPlayer = { id: OBR.player.id, role, connectionId };
  const authority = new AuthorityCoordinator(initialPlayer, initialParty);
  const engine = new ProximityEngine(authority);
  let stopItems: (() => void) | undefined;
  let stopGrid: (() => void) | undefined;
  let stopSceneMetadata: (() => void) | undefined;
  let latestItems = [] as Awaited<ReturnType<typeof OBR.scene.items.getItems>>;

  const updateBadge = async () => {
    try {
      await applyAuthorityBadge(authority.getSnapshot());
    } catch { /* badge feedback must not interrupt the runtime */ }
  };
  const stopAuthority = authority.subscribe(() => { engine.schedule(); void updateBadge(); });
  await authority.start();

  const refreshPlayer = async () => {
    const [role, connectionId] = await Promise.all([OBR.player.getRole(), OBR.player.getConnectionId()]);
    const player = { id: OBR.player.id, role, connectionId };
    engine.setPlayer(player);
    authority.setPlayer(player);
    void syncSelectedFacePivots(latestItems);
  };
  const refreshParty = async () => {
    const party = await OBR.party.getPlayers();
    engine.setParty(party);
    authority.setParty(party);
  };
  const attachScene = async (ready: boolean) => {
    stopItems?.();
    stopGrid?.();
    stopSceneMetadata?.();
    stopItems = undefined;
    stopGrid = undefined;
    stopSceneMetadata = undefined;
    if (!ready) {
      latestItems = [];
      await engine.clear();
      await clearSelectedFacePivots();
      return;
    }
    latestItems = await OBR.scene.items.getItems();
    engine.setItems(latestItems);
    void syncSelectedFacePivots(latestItems);
    stopItems = OBR.scene.items.onChange((items) => { latestItems = items; engine.setItems(items); void syncSelectedFacePivots(items); });
    stopGrid = OBR.scene.grid.onChange(() => engine.schedule());
    const applySettings = (metadata: Awaited<ReturnType<typeof OBR.scene.getMetadata>>) => engine.setDistanceMethod(parseSceneSettings(metadata[SETTINGS_KEY]).distanceMethod);
    applySettings(await OBR.scene.getMetadata());
    stopSceneMetadata = OBR.scene.onMetadataChange(applySettings);
  };

  const iconUrl = new URL("./icon.svg", window.location.href).href;
  void OBR.contextMenu.create({
    id: CONTEXT_MENU_ID,
    icons: [{
      icon: iconUrl,
      label: "Sting",
      filter: { min: 1, max: 1, roles: ["GM"], permissions: ["UPDATE"] },
    }],
    onClick: () => void OBR.action.open(),
  });

  const stopReady = OBR.scene.onReadyChange((ready) => void attachScene(ready));
  const stopPlayer = OBR.player.onChange(() => void refreshPlayer());
  const stopParty = OBR.party.onChange((party) => { engine.setParty(party); authority.setParty(party); });
  const integrationChanged = (event: StorageEvent) => { if (event.key === EMANATION_INTEGRATION_KEY) engine.schedule(); };
  window.addEventListener("storage", integrationChanged);
  engine.setPlayer(initialPlayer);
  engine.setParty(initialParty);
  void Promise.all([OBR.scene.isReady().then(attachScene), refreshPlayer(), refreshParty()]);

  window.addEventListener("beforeunload", () => {
    stopItems?.();
    stopGrid?.();
    stopSceneMetadata?.();
    stopReady();
    stopPlayer();
    stopParty();
    stopAuthority();
    window.removeEventListener("storage", integrationChanged);
    void OBR.contextMenu.remove(CONTEXT_MENU_ID);
    void engine.clear();
    void authority.stop();
    void OBR.action.setBadgeText(undefined);
    void clearSelectedFacePivots();
  }, { once: true });
});

import OBR from "@owlbear-rodeo/sdk";
import { CONTEXT_MENU_ID, EMANATION_INTEGRATION_KEY, SETTINGS_KEY } from "../constants";
import { ProximityEngine } from "./engine";
import { parseRoomSettings } from "../settings";
import { clearSelectedFacePivots, syncSelectedFacePivots } from "./pivotDebug";

OBR.onReady(() => {
  const engine = new ProximityEngine();
  let stopItems: (() => void) | undefined;
  let stopGrid: (() => void) | undefined;
  let latestItems = [] as Awaited<ReturnType<typeof OBR.scene.items.getItems>>;

  const refreshPlayer = async () => {
    const [role, connectionId] = await Promise.all([OBR.player.getRole(), OBR.player.getConnectionId()]);
    engine.setPlayer({ id: OBR.player.id, role, connectionId });
    void syncSelectedFacePivots(latestItems);
  };
  const refreshParty = async () => engine.setParty(await OBR.party.getPlayers());
  const attachScene = async (ready: boolean) => {
    stopItems?.();
    stopGrid?.();
    stopItems = undefined;
    stopGrid = undefined;
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
  };
  const refreshSettings = async () => engine.setDistanceMethod(parseRoomSettings((await OBR.room.getMetadata())[SETTINGS_KEY]).distanceMethod);

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
  const stopParty = OBR.party.onChange((party) => engine.setParty(party));
  const stopRoomMetadata = OBR.room.onMetadataChange((metadata) => engine.setDistanceMethod(parseRoomSettings(metadata[SETTINGS_KEY]).distanceMethod));
  const integrationChanged = (event: StorageEvent) => { if (event.key === EMANATION_INTEGRATION_KEY) engine.schedule(); };
  window.addEventListener("storage", integrationChanged);
  void Promise.all([OBR.scene.isReady().then(attachScene), refreshPlayer(), refreshParty(), refreshSettings()]);

  window.addEventListener("beforeunload", () => {
    stopItems?.();
    stopGrid?.();
    stopReady();
    stopPlayer();
    stopParty();
    stopRoomMetadata();
    window.removeEventListener("storage", integrationChanged);
    void OBR.contextMenu.remove(CONTEXT_MENU_ID);
    void engine.clear();
    void clearSelectedFacePivots();
  }, { once: true });
});

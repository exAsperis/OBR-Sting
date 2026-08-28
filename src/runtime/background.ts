import OBR from "@owlbear-rodeo/sdk";
import { CONTEXT_MENU_ID } from "../constants";
import { ProximityEngine } from "./engine";

OBR.onReady(() => {
  const engine = new ProximityEngine();
  let stopItems: (() => void) | undefined;
  let stopGrid: (() => void) | undefined;

  const refreshPlayer = async () => engine.setPlayer({ id: OBR.player.id, role: await OBR.player.getRole() });
  const refreshParty = async () => engine.setParty(await OBR.party.getPlayers());
  const attachScene = async (ready: boolean) => {
    stopItems?.();
    stopGrid?.();
    stopItems = undefined;
    stopGrid = undefined;
    if (!ready) {
      await engine.clear();
      return;
    }
    engine.setItems(await OBR.scene.items.getItems());
    stopItems = OBR.scene.items.onChange((items) => engine.setItems(items));
    stopGrid = OBR.scene.grid.onChange(() => engine.schedule());
  };

  const extensionUrl = new URL("./extension.html?context=1", window.location.href).href;
  const iconUrl = new URL("./icon.svg", window.location.href).href;
  void OBR.contextMenu.create({
    id: CONTEXT_MENU_ID,
    icons: [{
      icon: iconUrl,
      label: "Proximity Signals…",
      filter: { min: 1, max: 1, roles: ["GM"], permissions: ["UPDATE"] },
    }],
    embed: { url: extensionUrl, height: 700 },
  });

  const stopReady = OBR.scene.onReadyChange((ready) => void attachScene(ready));
  const stopPlayer = OBR.player.onChange(() => void refreshPlayer());
  const stopParty = OBR.party.onChange((party) => engine.setParty(party));
  void Promise.all([OBR.scene.isReady().then(attachScene), refreshPlayer(), refreshParty()]);

  window.addEventListener("beforeunload", () => {
    stopItems?.();
    stopGrid?.();
    stopReady();
    stopPlayer();
    stopParty();
    void OBR.contextMenu.remove(CONTEXT_MENU_ID);
    void engine.clear();
  }, { once: true });
});

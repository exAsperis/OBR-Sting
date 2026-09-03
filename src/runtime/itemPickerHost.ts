import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { EXTENSION_ID } from "../constants";
import { ITEM_PICKER_CHANNEL, type ItemPickerMessage } from "./itemPicker";

const TOOL_ID = `${EXTENSION_ID}/item-picker-tool`;
const MODE_ID = `${EXTENSION_ID}/item-picker-mode`;
interface HostedPick { requestId: string; previousTool: string; previousMode?: string; previousSelection?: string[]; restoring: boolean }

export function registerItemPickerHost(): () => void {
  let active: HostedPick | null = null;
  let stopPlayer: (() => void) | undefined;
  const finish = async (item: Item | null) => {
    const current = active;
    if (!current || current.restoring) return;
    current.restoring = true;
    try { await OBR.tool.activateTool(current.previousTool); if (current.previousMode) await OBR.tool.activateMode(current.previousTool, current.previousMode); } catch { /* previous tool may no longer exist */ }
    try { if (current.previousSelection?.length) await OBR.player.select(current.previousSelection, true); else await OBR.player.deselect(); } catch { /* best effort */ }
    try { await OBR.tool.removeMode(MODE_ID); } catch { /* best effort */ }
    try { await OBR.tool.remove(TOOL_ID); } catch { /* best effort */ }
    stopPlayer?.(); stopPlayer = undefined;
    if (active === current) active = null;
    await OBR.broadcast.sendMessage(ITEM_PICKER_CHANNEL, { type: "result", requestId: current.requestId, item } satisfies ItemPickerMessage, { destination: "LOCAL" });
  };
  const start = async (requestId: string) => {
    if (active) await finish(null);
    const [previousTool, previousMode, previousSelection] = await Promise.all([OBR.tool.getActiveTool(), OBR.tool.getActiveToolMode(), OBR.player.getSelection()]);
    const request: HostedPick = { requestId, previousTool, ...(previousMode ? { previousMode } : {}), ...(previousSelection ? { previousSelection } : {}), restoring: false };
    active = request;
    try {
      await OBR.tool.create({ id: TOOL_ID, icons: [{ icon: "/icon-reticle.svg", label: "Pick scene item", filter: { roles: ["GM"] } }], defaultMode: MODE_ID });
      await OBR.tool.createMode({ id: MODE_ID, icons: [{ icon: "/icon-reticle.svg", label: "Pick scene item", filter: { activeTools: [TOOL_ID], roles: ["GM"] } }], cursors: [{ cursor: "pointer" }], onToolClick: (_context, event) => { if (event.target) void finish(event.target); return false; }, onKeyDown: (_context, event) => { if (event.key === "Escape") void finish(null); }, onDeactivate: () => { if (active === request && !request.restoring) void finish(null); } });
      await OBR.tool.activateTool(TOOL_ID);
      await OBR.tool.activateMode(TOOL_ID, MODE_ID);
      stopPlayer = OBR.player.onChange(() => {
        if (active !== request || request.restoring) return;
        void Promise.all([OBR.player.getSelection(), OBR.scene.items.getItems()]).then(([selection, items]) => {
          if (active !== request || request.restoring) return;
          const previous = new Set(request.previousSelection ?? []);
          const pickedId = selection?.find((id) => !previous.has(id));
          const picked = items.find((candidate) => candidate.id === pickedId);
          if (picked) void finish(picked);
        });
      });
    } catch { if (active === request) await finish(null); }
  };
  const stopMessages = OBR.broadcast.onMessage(ITEM_PICKER_CHANNEL, (event) => { const message = event.data as Partial<ItemPickerMessage>; if (message.type === "start" && typeof message.requestId === "string") void start(message.requestId); if (message.type === "cancel" && active?.requestId === message.requestId) void finish(null); });
  return () => { stopMessages(); stopPlayer?.(); void finish(null); };
}

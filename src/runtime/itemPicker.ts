import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { EXTENSION_ID } from "../constants";

export const ITEM_PICKER_CHANNEL = `${EXTENSION_ID}/item-picker`;
export type ItemPickerMessage = { type: "start" | "cancel"; requestId: string } | { type: "result"; requestId: string; item: Item | null };
interface ActivePick { requestId: string; resolve: (item: Item | null) => void; stop: () => void }
let active: ActivePick | null = null;
export function isItemPickActive(): boolean { return active !== null; }
export function completeItemPickFromSelection(): boolean { return active !== null; }
function settle(requestId: string, item: Item | null) { if (!active || active.requestId !== requestId) return; const current = active; active = null; current.stop(); current.resolve(item); }
export async function cancelItemPick(): Promise<void> { const current = active; if (!current) return; try { await OBR.broadcast.sendMessage(ITEM_PICKER_CHANNEL, { type: "cancel", requestId: current.requestId } satisfies ItemPickerMessage, { destination: "LOCAL" }); } catch { settle(current.requestId, null); } }
export async function pickSceneItem(): Promise<Item | null> {
  await cancelItemPick();
  const requestId = crypto.randomUUID();
  return new Promise<Item | null>((resolve) => {
    const stop = OBR.broadcast.onMessage(ITEM_PICKER_CHANNEL, (event) => { const message = event.data as Partial<ItemPickerMessage>; if (message.type === "result" && message.requestId === requestId) settle(requestId, message.item ?? null); });
    active = { requestId, resolve, stop };
    void OBR.broadcast.sendMessage(ITEM_PICKER_CHANNEL, { type: "start", requestId } satisfies ItemPickerMessage, { destination: "LOCAL" }).catch(() => settle(requestId, null));
  });
}
if (typeof window !== "undefined") window.addEventListener("beforeunload", () => { void cancelItemPick(); }, { once: true });

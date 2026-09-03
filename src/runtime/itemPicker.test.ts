import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@owlbear-rodeo/sdk";

const bus = vi.hoisted(() => ({ handlers: new Set<(event: { data: unknown }) => void>(), sendMessage: vi.fn(), onMessage: vi.fn() }));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: { broadcast: { sendMessage: bus.sendMessage, onMessage: bus.onMessage } } }));
import { cancelItemPick, isItemPickActive, pickSceneItem } from "./itemPicker";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const target = { id: "target", name: "Target" } as Item;

describe("item picker action client", () => {
  beforeEach(async () => {
    bus.handlers.clear();
    bus.onMessage.mockImplementation((_channel, handler) => { bus.handlers.add(handler); return () => bus.handlers.delete(handler); });
    bus.sendMessage.mockImplementation(async (_channel, message) => {
      if (message.type === "cancel") for (const handler of [...bus.handlers]) handler({ data: { type: "result", requestId: message.requestId, item: null } });
    });
    await cancelItemPick();
    vi.clearAllMocks();
  });

  it("requests a background-hosted pick and resolves its result", async () => {
    const result = pickSceneItem();
    await flush();
    const start = bus.sendMessage.mock.calls[0][1];
    expect(start.type).toBe("start");
    expect(isItemPickActive()).toBe(true);
    for (const handler of [...bus.handlers]) handler({ data: { type: "result", requestId: start.requestId, item: target } });
    await expect(result).resolves.toBe(target);
    expect(isItemPickActive()).toBe(false);
  });

  it("cancels through the background host", async () => {
    const result = pickSceneItem();
    await flush();
    await cancelItemPick();
    await expect(result).resolves.toBeNull();
  });
});

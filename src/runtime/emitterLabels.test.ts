import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY, EMITTER_LABEL_DEBUG_KEY } from "../constants";
import { clearEmitterLabels, labelAllEmitters } from "./emitterLabels";

const { addItems, deleteItems, getItems, getItemBounds, built } = vi.hoisted(() => ({
  addItems: vi.fn(), deleteItems: vi.fn(), getItems: vi.fn(), getItemBounds: vi.fn(), built: [] as Item[],
}));

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: { scene: { local: { addItems, deleteItems, getItems }, items: { getItemBounds } } },
  buildLabel: () => {
    const value: Record<string, unknown> = { id: `label-${built.length + 1}`, metadata: {} };
    const builder = new Proxy({}, {
      get: (_target, property) => property === "build" ? () => { built.push(value as unknown as Item); return value; } : (...args: unknown[]) => { value[String(property)] = args.length === 1 ? args[0] : args; return builder; },
    });
    return builder;
  },
}));

const item = (id: string, signals?: string[]) => ({
  id, name: id, position: { x: 0, y: 0 }, metadata: signals ? { [EMITTER_KEY]: { version: 1, enabled: true, signals } } : {},
}) as Item;

describe("emitter debug labels", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    built.length = 0;
    getItems.mockResolvedValue([]);
    getItemBounds.mockResolvedValue({ min: { x: 0, y: 10 }, max: { x: 20, y: 30 }, center: { x: 10, y: 20 }, width: 20, height: 20 });
    addItems.mockResolvedValue(undefined);
    deleteItems.mockResolvedValue(undefined);
    await clearEmitterLabels();
    vi.clearAllMocks();
  });

  it("creates one attached local label with comma-delimited signals per tagged item", async () => {
    const count = await labelAllEmitters([item("a", ["light", "magic[30]"]), item("b"), item("c", ["sound"])]);
    expect(count).toBe(2);
    expect(addItems).toHaveBeenCalledOnce();
    expect(built.map((label) => (label as unknown as Record<string, unknown>).plainText)).toEqual(["light, magic[30]", "sound"]);
    expect(built.map((label) => (label as unknown as Record<string, unknown>).attachedTo)).toEqual(["a", "c"]);
    expect((built[0].metadata[EMITTER_LABEL_DEBUG_KEY] as { emitterId: string }).emitterId).toBe("a");
  });

  it("replaces prior Sting emitter labels before drawing", async () => {
    getItems.mockResolvedValue([{ id: "stale", metadata: { [EMITTER_LABEL_DEBUG_KEY]: { emitterId: "old" } } }] as unknown as Item[]);
    await labelAllEmitters([item("a", ["light"])]);
    expect(deleteItems).toHaveBeenCalledWith(["stale"]);
  });

  it("returns zero without adding labels when no emitters are tagged", async () => {
    expect(await labelAllEmitters([item("a")])).toBe(0);
    expect(addItems).not.toHaveBeenCalled();
  });
});

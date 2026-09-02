import type { Item } from "@owlbear-rodeo/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DETECTOR_KEY, EMITTER_KEY, RULE_LIBRARY_STORAGE_KEY } from "../constants";
import type { DetectionRuleV1 } from "../types";
import { parseStingApiRequest, StingPublicApi, type StingApiDependencies, type StingApiResult } from "./publicApi";

const template: DetectionRuleV1 = {
  id: "template", enabled: true, signal: "magic", matchType: "exact", excludeLayers: [], range: { inner: 0, outer: 30 },
  aggregation: "nearest", ignoreHidden: false, falloff: "binary", effects: [],
};

const item = (id: string, metadata: Record<string, unknown> = {}) => ({ id, metadata }) as Item;
const request = (type: "ADD_EMITTER_TAGS" | "REMOVE_EMITTER_TAGS" | "ADD_DETECTION_RULES" | "REMOVE_DETECTION_RULES", values: string[]) => ({
  version: 1, requestId: "request-1", source: "com.example.caller", type, sources: ["item-1"],
  ...(type.includes("EMITTER") ? { tags: values } : { rules: values }),
});

describe("Sting public API", () => {
  let items: Item[];
  let responses: StingApiResult[];
  let dependencies: StingApiDependencies;

  beforeEach(() => {
    items = [item("item-1")];
    responses = [];
    dependencies = {
      getRole: vi.fn(async () => "GM" as const),
      isSceneReady: vi.fn(async () => true),
      getItems: vi.fn(async (ids) => items.filter((entry) => ids.includes(entry.id)).map((entry) => structuredClone(entry))),
      updateItems: vi.fn(async (ids, update) => { update(items.filter((entry) => ids.includes(entry.id))); }),
      sendMessage: vi.fn(async (_channel, data) => { responses.push(data); }),
      storage: { getItem: (key) => key === RULE_LIBRARY_STORAGE_KEY ? JSON.stringify({ version: 1, entries: [{ id: "saved", name: "Alarm", rule: template }] }) : null },
    };
  });

  it("parses supported messages, deduplicates values, and rejects ad-hoc fields", () => {
    expect(parseStingApiRequest({ ...request("ADD_EMITTER_TAGS", [" fire ", "fire"]), sources: [" item-1 ", "item-1"] }))
      .toMatchObject({ sources: ["item-1"], tags: ["fire"] });
    expect(parseStingApiRequest({ ...request("ADD_DETECTION_RULES", ["Alarm"]), rule: template })).toBeNull();
    expect(parseStingApiRequest({ ...request("ADD_DETECTION_RULES", ["Alarm"]), effects: [] })).toBeNull();
  });

  it("rejects players before accessing the scene", async () => {
    dependencies.getRole = vi.fn(async () => "PLAYER" as const);
    const response = await new StingPublicApi(dependencies).handle(request("ADD_EMITTER_TAGS", ["fire"]));
    expect(response?.failures[0].code).toBe("GM_REQUIRED");
    expect(dependencies.isSceneReady).not.toHaveBeenCalled();
    expect(dependencies.getItems).not.toHaveBeenCalled();
  });

  it("reports duplicate emitter tags while adding other normalized tags", async () => {
    items[0].metadata[EMITTER_KEY] = { version: 1, enabled: false, signals: ["fire"] };
    const response = await new StingPublicApi(dependencies).handle(request("ADD_EMITTER_TAGS", ["fire", " Magic[30] ", "magic[30]"]));
    expect(response?.status).toBe("partial");
    expect(response?.failures).toContainEqual(expect.objectContaining({ code: "EMITTER_TAG_EXISTS", itemId: "item-1", name: "fire" }));
    expect(items[0].metadata[EMITTER_KEY]).toEqual({ version: 1, enabled: false, signals: ["fire", "magic[30]"] });
  });

  it("removes emitter tags and deletes empty emitter metadata", async () => {
    items[0].metadata[EMITTER_KEY] = { version: 1, enabled: true, signals: ["fire"] };
    await new StingPublicApi(dependencies).handle(request("REMOVE_EMITTER_TAGS", ["fire"]));
    expect(items[0].metadata[EMITTER_KEY]).toBeUndefined();
  });

  it("only instantiates saved rules, names them from the library, and creates fresh ids", async () => {
    const response = await new StingPublicApi(dependencies).handle(request("ADD_DETECTION_RULES", ["Alarm", "Ad hoc"]));
    const detector = items[0].metadata[DETECTOR_KEY] as { enabled: boolean; rules: DetectionRuleV1[] };
    expect(detector.enabled).toBe(true);
    expect(detector.rules[0]).toMatchObject({ name: "Alarm", signal: "magic" });
    expect(detector.rules[0].id).not.toBe(template.id);
    expect(response?.failures).toContainEqual(expect.objectContaining({ code: "RULE_LIBRARY_ENTRY_NOT_FOUND", name: "Ad hoc" }));
  });

  it("reports a duplicate named rule while adding another saved rule", async () => {
    items[0].metadata[DETECTOR_KEY] = { version: 1, enabled: false, rules: [{ ...template, id: "configured", name: "Alarm" }] };
    dependencies.storage = { getItem: () => JSON.stringify({ version: 1, entries: [
      { id: "alarm", name: "Alarm", rule: template }, { id: "warning", name: "Warning", rule: { ...template, id: "warning-template" } },
    ] }) };
    const response = await new StingPublicApi(dependencies).handle(request("ADD_DETECTION_RULES", ["Alarm", "Warning"]));
    const detector = items[0].metadata[DETECTOR_KEY] as { enabled: boolean; rules: DetectionRuleV1[] };
    expect(response?.status).toBe("partial");
    expect(response?.failures).toContainEqual(expect.objectContaining({ code: "DETECTION_RULE_EXISTS", name: "Alarm" }));
    expect(detector.enabled).toBe(false);
    expect(detector.rules.map((rule) => rule.name)).toEqual(["Alarm", "Warning"]);
  });

  it("removes every exact named rule and preserves nonmatching rules", async () => {
    items[0].metadata[DETECTOR_KEY] = { version: 1, enabled: true, rules: [
      { ...template, id: "a", name: "Alarm" }, { ...template, id: "b", name: "Alarm" }, { ...template, id: "c", name: "alarm" },
    ] };
    await new StingPublicApi(dependencies).handle(request("REMOVE_DETECTION_RULES", ["Alarm"]));
    const detector = items[0].metadata[DETECTOR_KEY] as { rules: DetectionRuleV1[] };
    expect(detector.rules.map((rule) => rule.name)).toEqual(["alarm"]);
  });

  it("preserves malformed metadata and reports missing items and update failures", async () => {
    items[0].metadata[EMITTER_KEY] = { broken: true };
    const malformed = await new StingPublicApi(dependencies).handle({ ...request("ADD_EMITTER_TAGS", ["fire"]), sources: ["item-1", "missing"] });
    expect(malformed?.failures.map((entry) => entry.code)).toEqual(expect.arrayContaining(["INVALID_EMITTER_METADATA", "ITEM_NOT_FOUND"]));
    expect(items[0].metadata[EMITTER_KEY]).toEqual({ broken: true });

    items[0].metadata = {};
    dependencies.updateItems = vi.fn(async () => { throw new Error("no permission"); });
    const failed = await new StingPublicApi(dependencies).handle(request("ADD_EMITTER_TAGS", ["fire"]));
    expect(failed?.status).toBe("failure");
    expect(failed?.failures.at(-1)?.code).toBe("UPDATE_FAILED");
  });

  it("returns no-scene and malformed-request results on the caller result channel", async () => {
    dependencies.isSceneReady = vi.fn(async () => false);
    expect((await new StingPublicApi(dependencies).handle(request("ADD_EMITTER_TAGS", ["fire"])))?.failures[0].code).toBe("SCENE_NOT_READY");
    expect((await new StingPublicApi(dependencies).handle({ version: 1, requestId: "bad", source: "caller", type: "ADD_DETECTION_RULES", sources: ["item-1"], rules: ["Alarm"], effects: [] }))?.failures[0].code).toBe("INVALID_REQUEST");
    expect(responses).toHaveLength(2);
  });
});

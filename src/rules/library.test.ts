import { describe, expect, it } from "vitest";
import { instantiateLibraryRule, loadRuleLibrary, parseRuleLibrary } from "./library";

const rule = {
  id: "template-rule", name: "Torch warning", enabled: true, signal: "light", matchType: "exact" as const, excludeLayers: [], range: { outer: 60, inner: 5 },
  aggregation: "all" as const, ignoreHidden: true, falloff: "smoothstep" as const,
  effects: [{ id: "template-effect", type: "shader" as const, enabled: true, target: { type: "detector" as const }, audience: { type: "everyone" as const }, preset: "glow" as const, shape: "circle" as const, placement: "above" as const, color: "#55aaff", maxIntensity: 1, spread: 1 }],
};

describe("rules library", () => {
  it("parses complete rules and ignores invalid entries", () => {
    expect(parseRuleLibrary({ version: 1, entries: [{ id: "entry", name: "  Warning  ", rule }, { id: "bad", name: "", rule }] }).entries)
      .toEqual([{ id: "entry", name: "Warning", rule }]);
  });

  it("instantiates an independent rule and fresh effect ids", () => {
    const instance = instantiateLibraryRule({ id: "entry", name: "Warning", rule });
    expect(instance).toMatchObject({ signal: "light", effects: [{ type: "shader" }] });
    expect(instance.id).not.toBe(rule.id);
    expect(instance.effects[0].id).not.toBe(rule.effects[0].id);
  });

  it("loads browser-local data and tolerates malformed JSON", () => {
    expect(loadRuleLibrary({ getItem: () => JSON.stringify({ version: 1, entries: [{ id: "entry", name: "Warning", rule }] }) }, "rules").entries).toHaveLength(1);
    expect(loadRuleLibrary({ getItem: () => "bad json" }, "rules").entries).toEqual([]);
  });
});

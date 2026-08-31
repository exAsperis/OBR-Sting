import { describe, expect, it } from "vitest";
import type { Light } from "@owlbear-rodeo/sdk";
import { isWithinLightArea } from "../../proximity/evaluate";
import { applyLightModifiers, shouldRetainInactiveAddedLight, type MutableLightState } from "./executor";
import type { DesiredEffect, LightEffectDefinitionV1 } from "../../types";

const light = (overrides: Partial<Light> = {}) => ({ type: "LIGHT", position: { x: 0, y: 0 }, rotation: 0, attenuationRadius: 100, sourceRadius: 0, falloff: 0.5, innerAngle: 360, outerAngle: 360, lightType: "PRIMARY", metadata: {}, ...overrides }) as Light;
const base: MutableLightState = { attenuationRadius: 100, sourceRadius: 0, falloff: 0.5, innerAngle: 360, outerAngle: 360, lightType: "PRIMARY" };
const context = (runtimeKey: string, effect: Partial<LightEffectDefinitionV1>): DesiredEffect => ({ runtimeKey, strength: 1, effect: { id: runtimeKey, type: "light", enabled: true, action: "modify", target: { type: "detected-emitter" }, audience: { type: "everyone" }, attenuationRadius: { value: 1 }, radiusOperation: "multiply", ...effect } } as DesiredEffect);

describe("light geometry", () => {
  it("includes inside and exact-radius points but excludes outside points", () => {
    expect(isWithinLightArea({ x: 99, y: 0 }, light())).toBe(true);
    expect(isWithinLightArea({ x: 100, y: 0 }, light())).toBe(true);
    expect(isWithinLightArea({ x: 101, y: 0 }, light())).toBe(false);
  });
  it("uses outerAngle and rotation for conical lights", () => {
    const cone = light({ outerAngle: 90, innerAngle: 30 });
    expect(isWithinLightArea({ x: 0, y: -50 }, cone)).toBe(true);
    expect(isWithinLightArea({ x: 50, y: 0 }, cone)).toBe(false);
    expect(isWithinLightArea({ x: 50, y: 0 }, { ...cone, rotation: 90 })).toBe(true);
  });
});

describe("light modifier composition", () => {
  it("composes simultaneous modifiers in stable runtime-key order", () => {
    const result = applyLightModifiers(base, [context("b", { attenuationRadius: { value: 20 }, radiusOperation: "add" }), context("a", { attenuationRadius: { value: 1.5 }, radiusOperation: "multiply", falloff: { value: 0.8 } })], (value) => value);
    expect(result.attenuationRadius).toBe(170);
    expect(result.falloff).toBe(0.8);
  });
  it("recomputes from base when modifiers end in either order", () => {
    const multiply = context("a", { attenuationRadius: { value: 1.5 }, radiusOperation: "multiply" });
    const add = context("b", { attenuationRadius: { value: 20 }, radiusOperation: "add" });
    expect(applyLightModifiers(base, [multiply, add], (v) => v).attenuationRadius).toBe(170);
    expect(applyLightModifiers(base, [add], (v) => v).attenuationRadius).toBe(120);
    expect(applyLightModifiers(base, [multiply], (v) => v).attenuationRadius).toBe(150);
    expect(applyLightModifiers(base, [], (v) => v)).toEqual(base);
  });
  it("maps normalized proximity into configured radius endpoints", () => {
    const dynamic = context("a", { attenuationRadius: { value: 6, range: { minimum: 1, maximum: 6 } }, radiusOperation: "set" });
    dynamic.strength = 0.5;
    expect(applyLightModifiers(base, [dynamic], (v) => v).attenuationRadius).toBe(3.5);
  });
});

describe("added-light duration", () => {
  it("removes temporary lights after deactivation", () => expect(shouldRetainInactiveAddedLight({ permanent: false })).toBe(false));
  it("retains permanent lights after deactivation", () => expect(shouldRetainInactiveAddedLight({ permanent: true })).toBe(true));
});

import { describe, expect, it } from "vitest";
import { SHADERS } from "./shaders";

describe("shader presets", () => {
  it("uses premultiplied alpha so masked pixels stay transparent", () => {
    for (const shader of Object.values(SHADERS)) {
      expect(shader).toContain("half3(signalColor) * alpha");
    }
  });

  it("lets glow range from a crisp ring to a soft aura", () => {
    expect(SHADERS.glow).toContain("innerFade");
    expect(SHADERS.glow).toContain("innerRadius <= 0.0001");
    expect(SHADERS.glow).toContain("centerOffset");
    expect(SHADERS.glow).toContain("effectSize");
    expect(SHADERS.glow).toContain("effectRotation");
    expect(SHADERS.glow).toContain("0.005");
    expect(SHADERS.glow).toContain("0.45");
  });

  it("supports opacity, flicker, and directional radial animation on every shader preset", () => {
    for (const shader of Object.values(SHADERS)) {
      expect(shader).toContain("animationMode");
      expect(shader).toContain("sin(time * rate");
      expect(shader).toContain("float noise");
      expect(shader).toContain("radialDirection");
      expect(shader).toContain("waveWidth");
      expect(shader).toContain("distanceFromCenter - innerRadius");
    }
  });

  it("aims the beam with direction and angular width uniforms", () => {
    expect(SHADERS.beam).toContain("beamDirection");
    expect(SHADERS.beam).toContain("beamWidth");
    expect(SHADERS.beam).toContain("angularDistance");
  });
});

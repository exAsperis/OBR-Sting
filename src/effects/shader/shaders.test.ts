import { describe, expect, it } from "vitest";
import { SHADERS } from "./shaders";

describe("shader presets", () => {
  it("uses premultiplied alpha so masked pixels stay transparent", () => {
    for (const shader of Object.values(SHADERS)) {
      expect(shader).toContain("half3(signalColor) * alpha");
    }
  });

  it("keeps outline distinct from the soft glow family", () => {
    expect(SHADERS.outline).toContain("innerEdge");
    expect(SHADERS.glow).toContain("innerFade");
    expect(SHADERS.glow).toContain("centerOffset");
    expect(SHADERS.outline).not.toBe(SHADERS.glow);
  });

  it("aims the beam with direction and angular width uniforms", () => {
    expect(SHADERS.beam).toContain("beamDirection");
    expect(SHADERS.beam).toContain("beamWidth");
    expect(SHADERS.beam).toContain("angularDistance");
  });
});

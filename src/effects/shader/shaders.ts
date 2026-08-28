import type { ShaderPreset } from "../../types";

const common = `
uniform shader scene;
uniform mat3 modelView;
uniform vec2 size;
uniform float time;
uniform vec3 signalColor;
uniform float strength;
uniform float rate;
uniform float depth;
uniform float spread;

float animationFactor() {
  return 1.0;
}

half4 main(float2 coord) {
  vec2 screen = (vec3(coord, 1.0) * modelView).xy;
  half4 source = scene.eval(screen);
  float amount = clamp(strength * animationFactor(), 0.0, 1.0);
  return half4(mix(source.rgb, half3(signalColor), amount * 0.55), source.a);
}`;

const pulse = common.replace("return 1.0;", "return mix(1.0 - depth, 1.0, 0.5 + 0.5 * sin(time * rate * 6.283185));");
const flicker = common.replace(
  "return 1.0;",
  "float noise = fract(sin(floor(time * max(rate, 0.01) * 12.0) * 43758.5453)); return mix(1.0 - depth, 1.0, noise);",
);
const glow = common.replace(
  "float amount = clamp(strength * animationFactor(), 0.0, 1.0);",
  "vec2 uv = coord / size; float edge = 1.0 - smoothstep(0.0, 0.5, min(min(uv.x, 1.0-uv.x), min(uv.y, 1.0-uv.y)) * spread * 2.0); float amount = clamp(strength * animationFactor() * mix(0.55, 1.0, edge), 0.0, 1.0);",
);
const outline = common.replace(
  "float amount = clamp(strength * animationFactor(), 0.0, 1.0);",
  "vec2 uv = coord / size; float border = 1.0 - smoothstep(0.0, clamp(0.018 * spread, 0.005, 0.12), min(min(uv.x, 1.0-uv.x), min(uv.y, 1.0-uv.y))); float amount = clamp(strength * border, 0.0, 1.0);",
);

export const SHADERS: Record<ShaderPreset, string> = { glow, pulse, flicker, outline };

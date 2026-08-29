import type { ShaderPreset } from "../../types";

const staticAnimation = "return 1.0;";
const pulseAnimation = "return mix(1.0 - depth, 1.0, 0.5 + 0.5 * sin(time * rate * 6.283185));";
const flickerAnimation = "float noise = fract(sin(floor(time * max(rate, 0.01) * 12.0) * 43758.5453)); return mix(1.0 - depth, 1.0, noise);";

const softAura = `
  float feather = clamp(0.10 * spread, 0.005, 0.45);
  float innerFade = smoothstep(max(0.0, innerRadius - feather), innerRadius, distanceFromCenter);
  float outerFade = 1.0 - smoothstep(max(innerRadius, outerRadius - feather), outerRadius, distanceFromCenter);
  float mask = innerFade * outerFade;
`;

function buildShader(mask: string, animation: string, opacity: number, extraUniforms = ""): string {
  return `
uniform vec2 size;
uniform float time;
uniform vec3 signalColor;
uniform float strength;
uniform float rate;
uniform float depth;
uniform float spread;
uniform vec2 centerOffset;
uniform float innerRadius;
uniform float outerRadius;
${extraUniforms}

float animationFactor() {
  ${animation}
}

half4 main(float2 coord) {
  vec2 centered = (coord / size - vec2(0.5)) * 2.0 - centerOffset;
  float distanceFromCenter = length(centered);
  ${mask}
  float alpha = clamp(strength * animationFactor() * mask * ${opacity.toFixed(2)}, 0.0, 1.0);
  return half4(half3(signalColor) * alpha, alpha);
}`;
}

const glow = buildShader(softAura, staticAnimation, 0.62);
const pulse = buildShader(softAura, pulseAnimation, 0.72);
const flicker = buildShader(softAura, flickerAnimation, 0.72);
const beamMask = `
  float feather = clamp(0.025 * spread, 0.008, 0.12);
  float radialMask = smoothstep(innerRadius, innerRadius + feather, distanceFromCenter)
    * (1.0 - smoothstep(max(innerRadius, outerRadius - feather), outerRadius, distanceFromCenter));
  float forward = smoothstep(-feather, feather, dot(centered, beamDirection));
  float angularDistance = acos(clamp(dot(normalize(centered + vec2(0.00001)), beamDirection), -1.0, 1.0));
  float halfWidth = radians(beamWidth * 0.5);
  float coneMask = 1.0 - smoothstep(max(0.0, halfWidth - feather), halfWidth, angularDistance);
  float mask = radialMask * forward * coneMask;
`;
const beam = buildShader(beamMask, staticAnimation, 0.82, "uniform vec2 beamDirection;\nuniform float beamWidth;");

export const SHADERS: Record<ShaderPreset, string> = { glow, pulse, flicker, beam };

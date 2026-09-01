import type { ShaderPreset } from "../../types";

const configurableAnimation = `
  if (animationMode < 0.5) return 1.0;
  if (animationMode < 1.5) return mix(1.0 - depth, 1.0, 0.5 + 0.5 * sin(time * rate * 6.283185));
  if (animationMode < 2.5) {
    float noise = fract(sin(floor(time * max(rate, 0.01) * 12.0) * 43758.5453));
    return mix(1.0 - depth, 1.0, noise);
  }
  float radialPosition = clamp((distanceFromCenter - innerRadius) / max(outerRadius - innerRadius, 0.0001), 0.0, 1.0);
  float cycle = fract(time * max(rate, 0.01));
  float waveCenter = radialDirection > 0.0 ? cycle : 1.0 - cycle;
  float waveDistance = abs(radialPosition - waveCenter);
  float waveFeather = max(0.005, waveWidth * 0.25);
  float wave = 1.0 - smoothstep(waveWidth * 0.5, waveWidth * 0.5 + waveFeather, waveDistance);
  return mix(1.0 - depth, 1.0, wave);
`;

const softAura = `
  float feather = spread <= 0.0 ? 0.0 : clamp(0.10 * spread, 0.005, 0.45);
  float innerFade = innerRadius <= 0.0001
    ? 1.0
    : feather <= 0.0
      ? step(innerRadius, distanceFromCenter)
      : smoothstep(max(0.0, innerRadius - feather), innerRadius, distanceFromCenter);
  float outerFade = feather <= 0.0
    ? 1.0 - step(outerRadius, distanceFromCenter)
    : 1.0 - smoothstep(max(innerRadius, outerRadius - feather), outerRadius, distanceFromCenter);
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
uniform float animationMode;
uniform float radialDirection;
uniform float waveWidth;
uniform float spread;
uniform float shapeMode;
uniform vec2 centerOffset;
uniform float innerRadius;
uniform float outerRadius;
uniform vec2 effectSize;
uniform float effectRotation;
${extraUniforms}

float animationFactor(float distanceFromCenter) {
  ${animation}
}

half4 main(float2 coord) {
  vec2 centered = (coord / size - vec2(0.5)) * 2.0 - centerOffset;
  float rotationCos = cos(effectRotation);
  float rotationSin = sin(effectRotation);
  centered = vec2(
    rotationCos * centered.x + rotationSin * centered.y,
    -rotationSin * centered.x + rotationCos * centered.y
  ) / max(effectSize, vec2(0.05));
  float circleDistance = length(centered);
  float squareDistance = max(abs(centered.x), abs(centered.y));
  float distanceFromCenter = mix(circleDistance, squareDistance, step(0.5, shapeMode));
  ${mask}
  float alpha = clamp(strength * animationFactor(distanceFromCenter) * mask * ${opacity.toFixed(2)}, 0.0, 1.0);
  return half4(half3(signalColor) * alpha, alpha);
}`;
}

const glow = buildShader(softAura, configurableAnimation, 0.62);
const beamMask = `
  float feather = spread <= 0.0 ? 0.0 : clamp(0.025 * spread, 0.008, 0.12);
  float radialMask = feather <= 0.0
    ? step(innerRadius, distanceFromCenter) * (1.0 - step(outerRadius, distanceFromCenter))
    : smoothstep(innerRadius, innerRadius + feather, distanceFromCenter)
      * (1.0 - smoothstep(max(innerRadius, outerRadius - feather), outerRadius, distanceFromCenter));
  float forward = feather <= 0.0
    ? step(0.0, dot(centered, beamDirection))
    : smoothstep(-feather, feather, dot(centered, beamDirection));
  float angularDistance = acos(clamp(dot(normalize(centered + vec2(0.00001)), beamDirection), -1.0, 1.0));
  float halfWidth = radians(beamWidth * 0.5);
  float forwardDistance = max(0.0, dot(centered, beamDirection));
  float beamProgress = clamp(forwardDistance / max(outerRadius, 0.0001), 0.0, 1.0);
  float originHalfWidth = beamOriginWidth * (1.0 - beamProgress);
  float expandedHalfWidth = atan(tan(halfWidth) + originHalfWidth / max(forwardDistance, 0.0001));
  float coneMask = feather <= 0.0
    ? 1.0 - step(expandedHalfWidth, angularDistance)
    : 1.0 - smoothstep(max(0.0, expandedHalfWidth - feather), max(0.00001, expandedHalfWidth), angularDistance);
  float mask = radialMask * forward * coneMask;
`;
const beam = buildShader(beamMask, configurableAnimation, 0.82, "uniform vec2 beamDirection;\nuniform float beamWidth;\nuniform float beamOriginWidth;");

export const SHADERS: Record<ShaderPreset, string> = { glow, beam };

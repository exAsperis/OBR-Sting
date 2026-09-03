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

const segmentedGlowMask = `${softAura}
  if (segmentCount > 1.5) {
    const float TAU = 6.28318530718;
    float wedgeWidth = TAU / segmentCount;
    float alignmentOffset = segmentAlignment < 0.5 ? wedgeWidth * 0.5 : 0.0;
    vec2 localSignalDirection = vec2(
      rotationCos * signalDirection.x + rotationSin * signalDirection.y,
      -rotationSin * signalDirection.x + rotationCos * signalDirection.y
    ) / max(effectSize, vec2(0.05));
    localSignalDirection = length(localSignalDirection) > 0.00001 ? normalize(localSignalDirection) : vec2(0.0, -1.0);
    vec2 pixelDirection = length(centered) > 0.00001 ? normalize(centered) : vec2(0.0, -1.0);
    float signalAngle = mod(atan(localSignalDirection.x, -localSignalDirection.y) + TAU, TAU);
    float pixelAngle = mod(atan(pixelDirection.x, -pixelDirection.y) + TAU, TAU);
    float signalSegment = floor(mod(signalAngle + alignmentOffset, TAU) / wedgeWidth);
    float segmentCenter = (signalSegment + 0.5) * wedgeWidth - alignmentOffset;
    float angularDistance = abs(atan(sin(pixelAngle - segmentCenter), cos(pixelAngle - segmentCenter)));
    float angularFeather = min(0.006, wedgeWidth * 0.08);
    float segmentMask = 1.0 - smoothstep(wedgeWidth * 0.5 - angularFeather, wedgeWidth * 0.5, angularDistance);
    mask *= segmentMask;
  }
`;
const glow = buildShader(segmentedGlowMask, configurableAnimation, 0.62, "uniform float segmentCount;\nuniform float segmentAlignment;\nuniform vec2 signalDirection;");
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

const edge = `
uniform vec2 size;
uniform mat3 view;
uniform float time;
uniform vec3 signalColor;
uniform float strength;
uniform float rate;
uniform float depth;
uniform float animationMode;
uniform float radialDirection;
uniform float waveWidth;
uniform float spread;
uniform vec2 indicatorCenter;
uniform vec2 indicatorDirection;
uniform float indicatorSize;
uniform vec2 indicatorScale;
uniform float appearanceMode;
uniform float indicatorRune;
uniform float indicatorVisible;

float edgeRuneSegment(vec2 point, vec2 start, vec2 end) {
  vec2 fromStart = point - start;
  vec2 segment = end - start;
  return length(fromStart - segment * clamp(dot(fromStart, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0));
}

float edgeRuneDistance(vec2 point, float glyph) {
  float d = 10.0;
  if (glyph < 0.5) {
    d = min(edgeRuneSegment(point, vec2(-0.58, -0.58), vec2(0.0, 0.62)), edgeRuneSegment(point, vec2(0.0, 0.62), vec2(0.58, -0.58)));
    d = min(d, edgeRuneSegment(point, vec2(-0.34, -0.18), vec2(0.34, -0.18)));
  } else if (glyph < 1.5) {
    d = min(edgeRuneSegment(point, vec2(0.35, -0.62), vec2(-0.28, -0.10)), edgeRuneSegment(point, vec2(-0.28, -0.10), vec2(0.30, 0.08)));
    d = min(d, edgeRuneSegment(point, vec2(0.30, 0.08), vec2(-0.38, 0.62)));
  } else if (glyph < 2.5) {
    d = edgeRuneSegment(point, vec2(0.0, -0.62), vec2(0.0, 0.62));
    d = min(d, edgeRuneSegment(point, vec2(0.0, -0.30), vec2(-0.48, -0.55)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, -0.30), vec2(0.48, -0.55)));
    d = min(d, edgeRuneSegment(point, vec2(-0.34, 0.32), vec2(0.34, 0.32)));
  } else if (glyph < 3.5) {
    d = min(edgeRuneSegment(point, vec2(-0.48, -0.58), vec2(0.48, 0.58)), edgeRuneSegment(point, vec2(0.48, -0.58), vec2(-0.48, 0.58)));
    d = min(d, edgeRuneSegment(point, vec2(-0.48, -0.58), vec2(0.48, -0.58)));
    d = min(d, edgeRuneSegment(point, vec2(-0.48, 0.58), vec2(0.48, 0.58)));
  } else if (glyph < 4.5) {
    d = min(edgeRuneSegment(point, vec2(0.0, -0.62), vec2(0.52, -0.05)), edgeRuneSegment(point, vec2(0.52, -0.05), vec2(0.0, 0.62)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, 0.62), vec2(-0.52, -0.05)));
    d = min(d, edgeRuneSegment(point, vec2(-0.52, -0.05), vec2(0.0, -0.62)));
    d = min(d, edgeRuneSegment(point, vec2(-0.34, 0.30), vec2(0.34, -0.30)));
  } else if (glyph < 5.5) {
    d = edgeRuneSegment(point, vec2(0.0, 0.62), vec2(0.0, -0.08));
    d = min(d, edgeRuneSegment(point, vec2(0.0, -0.08), vec2(-0.52, -0.58)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, -0.08), vec2(0.52, -0.58)));
    d = min(d, edgeRuneSegment(point, vec2(-0.34, 0.30), vec2(0.34, 0.30)));
  } else if (glyph < 6.5) {
    d = min(edgeRuneSegment(point, vec2(-0.50, -0.58), vec2(0.32, -0.18)), edgeRuneSegment(point, vec2(0.32, -0.18), vec2(-0.30, 0.18)));
    d = min(d, edgeRuneSegment(point, vec2(-0.30, 0.18), vec2(0.50, 0.58)));
    d = min(d, edgeRuneSegment(point, vec2(-0.42, 0.02), vec2(0.42, 0.02)));
  } else if (glyph < 7.5) {
    d = min(edgeRuneSegment(point, vec2(0.45, -0.55), vec2(-0.38, -0.30)), edgeRuneSegment(point, vec2(-0.38, -0.30), vec2(-0.38, 0.30)));
    d = min(d, edgeRuneSegment(point, vec2(-0.38, 0.30), vec2(0.45, 0.55)));
    d = min(d, edgeRuneSegment(point, vec2(-0.10, 0.0), vec2(0.52, 0.0)));
  } else if (glyph < 8.5) {
    d = min(edgeRuneSegment(point, vec2(0.0, -0.65), vec2(0.44, -0.12)), edgeRuneSegment(point, vec2(0.44, -0.12), vec2(0.0, 0.42)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, 0.42), vec2(-0.44, -0.12)));
    d = min(d, edgeRuneSegment(point, vec2(-0.44, -0.12), vec2(0.0, -0.65)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, 0.42), vec2(0.0, 0.65)));
  } else if (glyph < 9.5) {
    d = edgeRuneSegment(point, vec2(0.0, -0.62), vec2(0.0, 0.62));
    d = min(d, edgeRuneSegment(point, vec2(0.0, -0.28), vec2(-0.50, 0.12)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, 0.28), vec2(0.50, -0.12)));
    d = min(d, edgeRuneSegment(point, vec2(-0.38, -0.48), vec2(0.38, 0.48)));
  } else if (glyph < 10.5) {
    d = min(edgeRuneSegment(point, vec2(-0.52, 0.58), vec2(0.0, -0.62)), edgeRuneSegment(point, vec2(0.0, -0.62), vec2(0.52, 0.58)));
    d = min(d, edgeRuneSegment(point, vec2(-0.38, 0.20), vec2(0.38, 0.20)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, -0.62), vec2(0.0, 0.58)));
  } else if (glyph < 11.5) {
    d = edgeRuneSegment(point, vec2(-0.48, -0.58), vec2(-0.48, 0.58));
    d = min(d, edgeRuneSegment(point, vec2(-0.48, -0.58), vec2(0.44, -0.24)));
    d = min(d, edgeRuneSegment(point, vec2(0.44, -0.24), vec2(-0.48, 0.05)));
    d = min(d, edgeRuneSegment(point, vec2(-0.48, 0.05), vec2(0.50, 0.58)));
  } else if (glyph < 12.5) {
    d = min(edgeRuneSegment(point, vec2(0.48, -0.56), vec2(-0.48, -0.18)), edgeRuneSegment(point, vec2(-0.48, -0.18), vec2(0.48, 0.18)));
    d = min(d, edgeRuneSegment(point, vec2(0.48, 0.18), vec2(-0.48, 0.56)));
    d = min(d, edgeRuneSegment(point, vec2(-0.48, -0.18), vec2(-0.48, 0.56)));
  } else if (glyph < 13.5) {
    d = edgeRuneSegment(point, vec2(0.0, -0.64), vec2(0.0, 0.64));
    d = min(d, edgeRuneSegment(point, vec2(-0.48, -0.42), vec2(0.0, -0.05)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, -0.05), vec2(0.48, -0.42)));
    d = min(d, edgeRuneSegment(point, vec2(-0.48, 0.42), vec2(0.0, 0.05)));
    d = min(d, edgeRuneSegment(point, vec2(0.0, 0.05), vec2(0.48, 0.42)));
  } else if (glyph < 14.5) {
    d = min(edgeRuneSegment(point, vec2(-0.50, -0.55), vec2(0.50, -0.55)), edgeRuneSegment(point, vec2(0.50, -0.55), vec2(-0.30, 0.02)));
    d = min(d, edgeRuneSegment(point, vec2(-0.30, 0.02), vec2(0.50, 0.55)));
    d = min(d, edgeRuneSegment(point, vec2(-0.30, 0.02), vec2(0.28, 0.02)));
  } else {
    d = edgeRuneSegment(point, vec2(-0.44, -0.62), vec2(-0.44, 0.62));
    d = min(d, edgeRuneSegment(point, vec2(-0.44, -0.62), vec2(0.48, -0.62)));
    d = min(d, edgeRuneSegment(point, vec2(-0.44, -0.04), vec2(0.34, -0.04)));
    d = min(d, edgeRuneSegment(point, vec2(-0.44, 0.62), vec2(0.48, 0.62)));
  }
  return d;
}

float edgeAnimation(float radial) {
  if (animationMode < 0.5) return 1.0;
  if (animationMode < 1.5) return mix(1.0 - depth, 1.0, 0.5 + 0.5 * sin(time * rate * 6.283185));
  if (animationMode < 2.5) {
    float noise = fract(sin(floor(time * max(rate, 0.01) * 12.0) * 43758.5453));
    return mix(1.0 - depth, 1.0, noise);
  }
  float cycle = fract(time * max(rate, 0.01));
  float waveCenter = radialDirection > 0.0 ? cycle : 1.0 - cycle;
  float waveDistance = abs(radial - waveCenter);
  float wave = 1.0 - smoothstep(waveWidth * 0.5, waveWidth * 0.75 + 0.005, waveDistance);
  return mix(1.0 - depth, 1.0, wave);
}

half4 main(float2 coord) {
  vec2 screen = (vec3(coord, 1.0) * view).xy;
  vec2 delta = screen - indicatorCenter;
  vec2 forward = length(indicatorDirection) > 0.0001 ? normalize(indicatorDirection) : vec2(0.0, -1.0);
  vec2 right = vec2(forward.y, -forward.x);
  float radius = max(indicatorSize * 0.5, 1.0);
  vec2 safeScale = max(indicatorScale, vec2(0.05));
  vec2 point = vec2(dot(delta, right), dot(delta, forward)) / radius / safeScale;
  float diskDistance = length(point) - 0.72;
  float triangleDistance = max(abs(point.x) - max(0.0, (0.88 - point.y) * 0.58), max(-0.72 - point.y, point.y - 0.88));
  const float DIAGONAL = 0.70710678;
  vec2 cornerPoint = vec2(DIAGONAL * point.x + DIAGONAL * point.y, -DIAGONAL * point.x + DIAGONAL * point.y);
  float circleDistance = length(point) - 1.0;
  vec2 boxPoint = cornerPoint - vec2(0.5);
  float boxDistance = max(abs(boxPoint.x) - 0.5, abs(boxPoint.y) - 0.5);
  float imageBackdropDistance = min(circleDistance, boxDistance);
  float squareDistance = max(abs(point.x), abs(point.y)) - 0.72;
  float shapeDistance = appearanceMode < 0.5 ? triangleDistance : appearanceMode < 1.5 ? diskDistance : appearanceMode < 2.5 ? imageBackdropDistance : squareDistance;
  float feather = spread <= 0.0 ? 0.0 : max(0.75, spread * 2.0) / radius;
  float mask = feather <= 0.0 ? 1.0 - step(0.0, shapeDistance) : 1.0 - smoothstep(-feather, feather, shapeDistance);
  float glyphFeather = max(0.012, feather);
  float pointRadius = length(point);
  float targetDistance = min(pointRadius - 0.18, min(abs(pointRadius - 0.42) - 0.035, min(abs(pointRadius - 0.68) - 0.035, abs(pointRadius - 0.94) - 0.035)));
  float targetMask = 1.0 - smoothstep(-glyphFeather, glyphFeather, targetDistance);
  float wedgeAngle = abs(atan(point.x, -point.y));
  float wedgeMask = 1.0 - smoothstep(0.392699 - glyphFeather, 0.392699 + glyphFeather, wedgeAngle);
  float runeMask = 1.0 - smoothstep(0.055, 0.055 + glyphFeather * 2.0, edgeRuneDistance(point, indicatorRune));
  vec2 arcaneSquare0 = vec2(0.707107 * point.x - 0.707107 * point.y, 0.707107 * point.x + 0.707107 * point.y);
  vec2 arcaneSquare30 = vec2(0.965926 * point.x - 0.258819 * point.y, 0.258819 * point.x + 0.965926 * point.y);
  vec2 arcaneSquare60 = vec2(0.965926 * point.x + 0.258819 * point.y, -0.258819 * point.x + 0.965926 * point.y);
  float arcaneDistance = min(abs(pointRadius - 0.96), min(abs(max(abs(arcaneSquare0.x), abs(arcaneSquare0.y)) - 0.68), min(abs(max(abs(arcaneSquare30.x), abs(arcaneSquare30.y)) - 0.68), abs(max(abs(arcaneSquare60.x), abs(arcaneSquare60.y)) - 0.68))));
  float arcaneMask = 1.0 - smoothstep(0.025, 0.025 + glyphFeather * 2.0, arcaneDistance);
  if (appearanceMode > 3.5 && appearanceMode < 4.5) mask = targetMask;
  if (appearanceMode > 4.5 && appearanceMode < 5.5) mask = targetMask * wedgeMask;
  if (appearanceMode > 5.5 && appearanceMode < 6.5) mask = runeMask;
  if (appearanceMode > 6.5) mask = arcaneMask;
  float radial = clamp(length(point), 0.0, 1.0);
  float alpha = clamp(indicatorVisible * strength * edgeAnimation(radial) * mask * 0.90, 0.0, 1.0);
  return half4(half3(signalColor) * alpha, alpha);
}`;

export const RADAR_ECHO_CAPACITY = 32;
const radarEchoUniforms = Array.from({ length: RADAR_ECHO_CAPACITY }, (_, index) => `uniform vec2 echoPosition${index};\nuniform float echoIntensity${index};\nuniform float echoSize${index};\nuniform float echoRune${index};\nuniform vec3 echoColor${index};`).join("\n");
const radarEchoLayers = Array.from({ length: RADAR_ECHO_CAPACITY }, (_, index) => `
  float echoDistance${index} = length(local - echoPosition${index});
  vec2 echoRunePoint${index} = (local - echoPosition${index}) / max(echoSize${index}, 0.0001);
  float echoRuneDistance${index} = runeDistance(echoRunePoint${index}, echoRune${index});
  float echoRuneCore${index} = 1.0 - smoothstep(0.075, 0.13, echoRuneDistance${index});
  float echoRuneGlow${index} = exp(-echoRuneDistance${index} * echoRuneDistance${index} / 0.035) * 0.32;
  float echo${index} = echoStyle < 0.5
    ? 1.0 - smoothstep(echoSize${index} * 0.72, echoSize${index}, echoDistance${index})
    : echoStyle < 1.5
      ? exp(-echoDistance${index} * echoDistance${index} / max(echoSize${index} * echoSize${index} * 0.45, 0.000001))
      : max(echoRuneCore${index}, echoRuneGlow${index});
  float echoContribution${index} = echo${index} * echoIntensity${index};
  if (echoContribution${index} > echoes) {
    echoes = echoContribution${index};
    echoBaseColor = echoColor${index};
    echoColorWeight = echoContribution${index} * echoIntensity${index};
  }`).join("\n");

const radar = `
uniform vec2 size;
uniform vec3 signalColor;
uniform float strength;
uniform float depth;
uniform float sweepPhase;
uniform float sweepType;
uniform float sweepDirection;
uniform float waveWidth;
uniform float spread;
uniform float shapeMode;
uniform float echoStyle;
uniform float decorationMode;
uniform float trailEnabled;
uniform float brightness;
uniform vec2 centerOffset;
uniform float innerRadius;
uniform float outerRadius;
uniform vec2 effectSize;
uniform float effectRotation;
${radarEchoUniforms}

float runeSegment(vec2 point, vec2 start, vec2 end) {
  vec2 fromStart = point - start;
  vec2 segment = end - start;
  return length(fromStart - segment * clamp(dot(fromStart, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0));
}

float runeDistance(vec2 point, float glyph) {
  float distanceToRune = 10.0;
  if (glyph < 0.5) {
    distanceToRune = min(runeSegment(point, vec2(-0.58, -0.58), vec2(0.0, 0.62)), runeSegment(point, vec2(0.0, 0.62), vec2(0.58, -0.58)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.34, -0.18), vec2(0.34, -0.18)));
  } else if (glyph < 1.5) {
    distanceToRune = min(runeSegment(point, vec2(0.35, -0.62), vec2(-0.28, -0.10)), runeSegment(point, vec2(-0.28, -0.10), vec2(0.30, 0.08)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.30, 0.08), vec2(-0.38, 0.62)));
  } else if (glyph < 2.5) {
    distanceToRune = runeSegment(point, vec2(0.0, -0.62), vec2(0.0, 0.62));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.30), vec2(-0.48, -0.55)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.30), vec2(0.48, -0.55)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.34, 0.32), vec2(0.34, 0.32)));
  } else if (glyph < 3.5) {
    distanceToRune = min(runeSegment(point, vec2(-0.48, -0.58), vec2(0.48, 0.58)), runeSegment(point, vec2(0.48, -0.58), vec2(-0.48, 0.58)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.48, -0.58), vec2(0.48, -0.58)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.48, 0.58), vec2(0.48, 0.58)));
  } else if (glyph < 4.5) {
    distanceToRune = min(runeSegment(point, vec2(0.0, -0.62), vec2(0.52, -0.05)), runeSegment(point, vec2(0.52, -0.05), vec2(0.0, 0.62)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, 0.62), vec2(-0.52, -0.05)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.52, -0.05), vec2(0.0, -0.62)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.34, 0.30), vec2(0.34, -0.30)));
  } else if (glyph < 5.5) {
    distanceToRune = runeSegment(point, vec2(0.0, 0.62), vec2(0.0, -0.08));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.08), vec2(-0.52, -0.58)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.08), vec2(0.52, -0.58)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.34, 0.30), vec2(0.34, 0.30)));
  } else if (glyph < 6.5) {
    distanceToRune = min(runeSegment(point, vec2(-0.50, -0.58), vec2(0.32, -0.18)), runeSegment(point, vec2(0.32, -0.18), vec2(-0.30, 0.18)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.30, 0.18), vec2(0.50, 0.58)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.42, 0.02), vec2(0.42, 0.02)));
  } else if (glyph < 7.5) {
    distanceToRune = min(runeSegment(point, vec2(0.45, -0.55), vec2(-0.38, -0.30)), runeSegment(point, vec2(-0.38, -0.30), vec2(-0.38, 0.30)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.38, 0.30), vec2(0.45, 0.55)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.10, 0.0), vec2(0.52, 0.0)));
  } else if (glyph < 8.5) {
    distanceToRune = min(runeSegment(point, vec2(0.0, -0.65), vec2(0.44, -0.12)), runeSegment(point, vec2(0.44, -0.12), vec2(0.0, 0.42)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, 0.42), vec2(-0.44, -0.12)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.44, -0.12), vec2(0.0, -0.65)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, 0.42), vec2(0.0, 0.65)));
  } else if (glyph < 9.5) {
    distanceToRune = runeSegment(point, vec2(0.0, -0.62), vec2(0.0, 0.62));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.28), vec2(-0.50, 0.12)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, 0.28), vec2(0.50, -0.12)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.38, -0.48), vec2(0.38, 0.48)));
  } else if (glyph < 10.5) {
    distanceToRune = min(runeSegment(point, vec2(-0.52, 0.58), vec2(0.0, -0.62)), runeSegment(point, vec2(0.0, -0.62), vec2(0.52, 0.58)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.38, 0.20), vec2(0.38, 0.20)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.62), vec2(0.0, 0.58)));
  } else if (glyph < 11.5) {
    distanceToRune = runeSegment(point, vec2(-0.48, -0.58), vec2(-0.48, 0.58));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.48, -0.58), vec2(0.44, -0.24)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.44, -0.24), vec2(-0.48, 0.05)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.48, 0.05), vec2(0.50, 0.58)));
  } else if (glyph < 12.5) {
    distanceToRune = min(runeSegment(point, vec2(0.48, -0.56), vec2(-0.48, -0.18)), runeSegment(point, vec2(-0.48, -0.18), vec2(0.48, 0.18)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.48, 0.18), vec2(-0.48, 0.56)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.48, -0.18), vec2(-0.48, 0.56)));
  } else if (glyph < 13.5) {
    distanceToRune = runeSegment(point, vec2(0.0, -0.64), vec2(0.0, 0.64));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.48, -0.42), vec2(0.0, -0.05)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.05), vec2(0.48, -0.42)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.48, 0.42), vec2(0.0, 0.05)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, 0.05), vec2(0.48, 0.42)));
  } else if (glyph < 14.5) {
    distanceToRune = min(runeSegment(point, vec2(-0.50, -0.55), vec2(0.50, -0.55)), runeSegment(point, vec2(0.50, -0.55), vec2(-0.30, 0.02)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.30, 0.02), vec2(0.50, 0.55)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.30, 0.02), vec2(0.28, 0.02)));
  } else {
    distanceToRune = runeSegment(point, vec2(-0.44, -0.62), vec2(-0.44, 0.62));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.44, -0.62), vec2(0.48, -0.62)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.44, -0.04), vec2(0.34, -0.04)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.44, 0.62), vec2(0.48, 0.62)));
  }
  return distanceToRune;
}

half4 main(float2 coord) {
  vec2 centered = (coord / size - vec2(0.5)) * 2.0 - centerOffset;
  float rotationCos = cos(effectRotation);
  float rotationSin = sin(effectRotation);
  vec2 local = vec2(rotationCos * centered.x + rotationSin * centered.y, -rotationSin * centered.x + rotationCos * centered.y) / max(effectSize, vec2(0.05));
  float circleDistance = length(local);
  float squareDistance = max(abs(local.x), abs(local.y));
  float distanceFromCenter = mix(circleDistance, squareDistance, step(0.5, shapeMode));
  float feather = spread <= 0.0 ? 0.002 : clamp(0.04 * spread, 0.002, 0.18);
  float innerMask = innerRadius <= 0.0001 ? 1.0 : smoothstep(max(0.0, innerRadius - feather), innerRadius, distanceFromCenter);
  float discMask = innerMask * (1.0 - smoothstep(max(innerRadius, outerRadius - feather), outerRadius, distanceFromCenter));
  float radialPosition = clamp((distanceFromCenter - innerRadius) / max(outerRadius - innerRadius, 0.0001), 0.0, 1.0);
  float angularPosition = fract(atan(local.x, -local.y) / 6.283185 + 1.0);
  float linePosition = mix(radialPosition, angularPosition, step(0.5, sweepType));
  float lineDistance = abs(linePosition - sweepPhase);
  if (sweepType > 0.5) lineDistance = min(lineDistance, 1.0 - lineDistance);
  float lineFeather = max(0.004, waveWidth * 0.08);
  float sweep = 1.0 - smoothstep(waveWidth * 0.5, waveWidth * 0.5 + lineFeather, lineDistance);
  float trailDistance = sweepDirection > 0.0 ? fract(sweepPhase - linePosition + 1.0) : fract(linePosition - sweepPhase + 1.0);
  float trailSpan = 0.5 * trailEnabled;
  float trailProgress = clamp(trailDistance / max(trailSpan, 0.0001), 0.0, 1.0);
  float trailFade = 1.0 - log(1.0 + 9.0 * trailProgress) / log(10.0);
  float trail = step(0.0001, trailSpan) * step(trailDistance, trailSpan) * max(0.0, trailFade);
  float echoes = 0.0;
  float echoColorWeight = 0.0;
  vec3 echoBaseColor = signalColor;
  ${radarEchoLayers}
  float sweepEnabled = step(-0.5, sweepType);
  float sweepSignal = max(sweep, trail) * sweepEnabled;
  float sweepColorWeight = max(sweep, trail * trailFade) / max(sweepSignal, 0.0001);
  float echoColorMix = echoColorWeight / max(echoes, 0.0001);
  float sweepAlpha = sweepSignal * depth * strength * discMask;
  float echoAlpha = echoes * strength * discMask;
  float ringDistance = min(min(abs(radialPosition - 0.34), abs(radialPosition - 0.67)), abs(radialPosition - 0.995));
  float rings = 1.0 - smoothstep(0.004, 0.008, ringDistance);
  float spokeDistance = abs(fract(angularPosition * 12.0 + 0.5) - 0.5);
  float spokes = (1.0 - smoothstep(0.018, 0.032, spokeDistance)) * step(0.32, radialPosition);
  float arcGate = step(0.16, abs(sin(angularPosition * 18.849555)));
  float innerBand = 1.0 - smoothstep(0.19, 0.205, radialPosition);
  float innerSegmentAngle = 1.0 - step(0.30, fract(angularPosition + 0.08));
  float outerSegmentAngle = 1.0 - step(0.30, fract(angularPosition + 0.56));
  float innerSegment = smoothstep(0.215, 0.225, radialPosition) * (1.0 - smoothstep(0.275, 0.285, radialPosition)) * innerSegmentAngle;
  float outerSegment = smoothstep(0.90, 0.91, radialPosition) * (1.0 - smoothstep(0.97, 0.98, radialPosition)) * outerSegmentAngle;
  float m314Decoration = max(max(spokes, rings * arcGate), max(innerBand, max(innerSegment, outerSegment)));
  float localPixel = 2.0 / max(min(size.x * effectSize.x, size.y * effectSize.y), 1.0);
  float radialSpan = max(outerRadius - innerRadius, 0.0001);
  float modernThinRingDistance = min(
    min(abs(distanceFromCenter - innerRadius), abs(distanceFromCenter - (innerRadius + radialSpan * 0.25))),
    min(abs(distanceFromCenter - (innerRadius + radialSpan * 0.50)), abs(distanceFromCenter - (innerRadius + radialSpan * 0.75)))
  );
  float modernThinRings = 1.0 - smoothstep(0.0, localPixel * 0.45, modernThinRingDistance);
  float modernOuterRing = 1.0 - smoothstep(localPixel * 0.8333, localPixel * 1.8333, abs(distanceFromCenter - outerRadius));
  float modernNorth = 1.0 - step(0.0, local.y);
  float modernRadialBounds = step(innerRadius, distanceFromCenter) * step(distanceFromCenter, outerRadius);
  float modernVertical = (1.0 - smoothstep(0.0, localPixel * 0.45, abs(local.x))) * modernNorth * modernRadialBounds;
  float modernTickDistance = min(
    min(min(abs(distanceFromCenter - (innerRadius + radialSpan * 0.10)), abs(distanceFromCenter - (innerRadius + radialSpan * 0.20))), min(abs(distanceFromCenter - (innerRadius + radialSpan * 0.30)), abs(distanceFromCenter - (innerRadius + radialSpan * 0.40)))),
    min(min(abs(distanceFromCenter - (innerRadius + radialSpan * 0.50)), abs(distanceFromCenter - (innerRadius + radialSpan * 0.60))), min(abs(distanceFromCenter - (innerRadius + radialSpan * 0.70)), min(abs(distanceFromCenter - (innerRadius + radialSpan * 0.80)), abs(distanceFromCenter - (innerRadius + radialSpan * 0.90)))))
  );
  float modernTickLength = max(localPixel * 4.0, radialSpan * 0.025);
  float modernTicks = (1.0 - smoothstep(0.0, localPixel * 0.45, modernTickDistance)) * (1.0 - smoothstep(modernTickLength, modernTickLength + localPixel, abs(local.x))) * modernNorth;
  float modernDecoration = max(max(modernThinRings, modernOuterRing), max(modernVertical, modernTicks));
  float arcaneOuterRing = 1.0 - smoothstep(localPixel * 0.5, localPixel * 1.5, abs(distanceFromCenter - outerRadius));
  float arcaneInnerRing = 1.0 - smoothstep(0.0, localPixel * 0.45, abs(distanceFromCenter - innerRadius));
  vec2 arcaneSquare0Point = vec2(0.707107 * local.x - 0.707107 * local.y, 0.707107 * local.x + 0.707107 * local.y);
  vec2 arcaneSquare30Point = vec2(0.965926 * local.x - 0.258819 * local.y, 0.258819 * local.x + 0.965926 * local.y);
  vec2 arcaneSquare60Point = vec2(0.965926 * local.x + 0.258819 * local.y, -0.258819 * local.x + 0.965926 * local.y);
  float arcaneSquareExtent = outerRadius * 0.707107;
  float arcaneSquareDistance = min(
    abs(max(abs(arcaneSquare0Point.x), abs(arcaneSquare0Point.y)) - arcaneSquareExtent),
    min(abs(max(abs(arcaneSquare30Point.x), abs(arcaneSquare30Point.y)) - arcaneSquareExtent), abs(max(abs(arcaneSquare60Point.x), abs(arcaneSquare60Point.y)) - arcaneSquareExtent))
  );
  float arcaneSquares = 1.0 - smoothstep(localPixel * 0.5, localPixel * 1.5, arcaneSquareDistance);
  float arcaneDecoration = max(max(arcaneOuterRing, arcaneInnerRing), arcaneSquares);
  float m314Enabled = step(0.5, decorationMode) * (1.0 - step(1.5, decorationMode));
  float modernEnabled = step(1.5, decorationMode) * (1.0 - step(2.5, decorationMode));
  float arcaneEnabled = step(2.5, decorationMode);
  float decoration = max(max(m314Enabled * discMask * m314Decoration, modernEnabled * modernDecoration), arcaneEnabled * arcaneDecoration);
  float interlace = mix(0.62, 1.0, step(0.5, fract(floor(coord.y) * 0.5)));
  float crtEnabled = m314Enabled + modernEnabled;
  float decorationAlpha = decoration * 0.72 * mix(1.0, interlace, crtEnabled);
  float activeAlpha = max(sweepAlpha, echoAlpha);
  float alpha = clamp(max(activeAlpha, decorationAlpha), 0.0, 1.0);
  vec3 sweepActiveColor = mix(signalColor, vec3(1.0), clamp(brightness * sweepColorWeight, 0.0, 1.0));
  vec3 echoActiveColor = mix(echoBaseColor, vec3(1.0), clamp(brightness * echoColorMix, 0.0, 1.0));
  vec3 activeColor = sweepAlpha >= echoAlpha ? sweepActiveColor : echoActiveColor;
  half3 rgb = half3(activeAlpha >= decorationAlpha ? activeColor : signalColor) * alpha;
  return half4(rgb, alpha);
}`;

export const GRID_MARKER_CAPACITY = 32;
const gridMarkerUniforms = Array.from({ length: GRID_MARKER_CAPACITY }, (_, index) => `uniform vec3 markerDataA${index};\nuniform vec3 markerDataB${index};\nuniform vec3 markerDataC${index};\nuniform vec3 markerDataD${index};\nuniform vec3 markerColor${index};`).join("\n");
const gridMarkerLayers = Array.from({ length: GRID_MARKER_CAPACITY }, (_, index) => `
  vec2 markerDelta${index} = local - markerDataA${index}.yz;
  float markerRectDistance${index} = max(abs(markerDelta${index}.x) - markerDataB${index}.x, abs(markerDelta${index}.y) - markerDataB${index}.y);
  float markerRectScale${index} = max(0.0001, min(markerDataB${index}.x, markerDataB${index}.y));
  float markerRectFeather${index} = clamp(markerRectScale${index} * spread * 0.12, 0.0001, markerRectScale${index} * 0.9);
  float markerRect${index} = spread <= 0.0 ? step(markerRectDistance${index}, 0.0) : 1.0 - smoothstep(-markerRectFeather${index}, markerRectFeather${index}, markerRectDistance${index});
  float markerCos${index} = cos(markerDataC${index}.z);
  float markerSin${index} = sin(markerDataC${index}.z);
  vec2 markerLightPoint${index} = vec2(markerCos${index} * markerDelta${index}.x + markerSin${index} * markerDelta${index}.y, -markerSin${index} * markerDelta${index}.x + markerCos${index} * markerDelta${index}.y);
  float markerDistance${index} = length(markerLightPoint${index});
  float markerRadial${index} = 1.0 - smoothstep(markerDataC${index}.x, max(markerDataC${index}.x + 0.0001, markerDataB${index}.z), markerDistance${index});
  markerRadial${index} = pow(max(markerRadial${index}, 0.0), max(markerDataC${index}.y, 0.05));
  float markerAngle${index} = abs(atan(markerLightPoint${index}.x, -markerLightPoint${index}.y));
  float markerCone${index} = markerRadial${index} * (1.0 - smoothstep(markerDataD${index}.z * 0.5 - 0.015, markerDataD${index}.z * 0.5 + 0.015, markerAngle${index}));
  markerCone${index} *= mix(0.72, 1.0, 1.0 - smoothstep(markerDataD${index}.y * 0.5 - 0.015, markerDataD${index}.y * 0.5 + 0.015, markerAngle${index}));
  float markerMask${index} = markerDataA${index}.x < 0.5 ? 0.0 : markerDataA${index}.x < 1.5 ? markerRect${index} : markerDataA${index}.x < 2.5 ? markerRadial${index} : markerCone${index};
  float markerAlpha${index} = markerMask${index} * markerDataD${index}.x;
  if (markerAlpha${index} > markerAlpha) { markerAlpha = markerAlpha${index}; markerRgb = markerColor${index}; }
`).join("\n");

const grid = `
uniform vec2 size;
uniform vec3 signalColor;
uniform float strength;
uniform float spread;
uniform float shapeMode;
uniform vec2 centerOffset;
uniform float innerRadius;
uniform float outerRadius;
uniform vec2 effectSize;
uniform float effectRotation;
uniform float showGrid;
uniform float gridType;
uniform float gridDpi;
uniform float worldRange;
uniform vec2 worldOrigin;
${gridMarkerUniforms}

float gridStroke(float distanceToLine) {
  return 1.0 - smoothstep(3.0, 6.0, distanceToLine);
}

float gridLine(float coordinate, float spacing) {
  float lineDistance = abs(fract(coordinate / max(spacing, 1.0) + 0.5) - 0.5) * spacing;
  return gridStroke(lineDistance);
}

half4 main(float2 coord) {
  vec2 centered = (coord / size - vec2(0.5)) * 2.0 - centerOffset;
  float rotationCos = cos(effectRotation);
  float rotationSin = sin(effectRotation);
  vec2 local = vec2(rotationCos * centered.x + rotationSin * centered.y, -rotationSin * centered.x + rotationCos * centered.y) / max(effectSize, vec2(0.05));
  float circleDistance = length(local);
  float squareDistance = max(abs(local.x), abs(local.y));
  float distanceFromCenter = mix(circleDistance, squareDistance, step(0.5, shapeMode));
  float feather = spread <= 0.0 ? 0.001 : clamp(0.02 * spread, 0.001, 0.10);
  float innerMask = innerRadius <= 0.0001 ? 1.0 : smoothstep(max(0.0, innerRadius - feather), innerRadius, distanceFromCenter);
  float clipMask = innerMask * (1.0 - smoothstep(max(innerRadius, outerRadius - feather), outerRadius, distanceFromCenter));
  vec2 worldPoint = worldOrigin + local * worldRange / max(outerRadius, 0.0001);
  float squareGrid = max(gridLine(worldPoint.x, gridDpi), gridLine(worldPoint.y, gridDpi));
  float isoWidth = gridDpi * mix(2.0, 1.732051, step(3.5, gridType));
  float isoU = worldPoint.y + worldPoint.x * gridDpi / isoWidth;
  float isoV = worldPoint.y - worldPoint.x * gridDpi / isoWidth;
  float isoGrid = max(gridLine(isoU, gridDpi), gridLine(isoV, gridDpi));
  vec2 hexPoint = (gridType < 1.5 ? worldPoint : worldPoint.yx) / max(gridDpi, 1.0);
  vec2 hexRepeat = vec2(1.0, 1.732051);
  vec2 hexA = mod(hexPoint, hexRepeat) - hexRepeat * 0.5;
  vec2 hexB = mod(hexPoint - hexRepeat * 0.5, hexRepeat) - hexRepeat * 0.5;
  vec2 hexCell = dot(hexA, hexA) < dot(hexB, hexB) ? hexA : hexB;
  float hexEdgeDistance = abs(0.5 - max(abs(hexCell.x) * 0.866025 + abs(hexCell.y) * 0.5, abs(hexCell.y))) * gridDpi;
  float hexGrid = gridStroke(hexEdgeDistance);
  float sceneGrid = gridType < 0.5 ? squareGrid : gridType < 2.5 ? hexGrid : isoGrid;
  float markerAlpha = 0.0;
  vec3 markerRgb = signalColor;
  ${gridMarkerLayers}
  markerAlpha = clamp(markerAlpha, 0.0, 1.0) * clipMask;
  float gridAlpha = sceneGrid * showGrid * 0.24 * clipMask;
  float alpha = max(markerAlpha, gridAlpha);
  vec3 rgb = markerAlpha >= gridAlpha ? markerRgb : signalColor;
  return half4(half3(rgb) * alpha, alpha);
}`;

export const SHADERS: Record<ShaderPreset, string> = { glow, beam, radar, grid, edge };

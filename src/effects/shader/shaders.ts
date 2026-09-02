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
  } else {
    distanceToRune = runeSegment(point, vec2(0.0, -0.62), vec2(0.0, 0.62));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, -0.28), vec2(-0.50, 0.12)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(0.0, 0.28), vec2(0.50, -0.12)));
    distanceToRune = min(distanceToRune, runeSegment(point, vec2(-0.38, -0.48), vec2(0.38, 0.48)));
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

export const SHADERS: Record<ShaderPreset, string> = { glow, beam, radar };

import { describe, expect, it } from "vitest";
import { SHADERS } from "./shaders";

describe("shader presets", () => {
  it("uses premultiplied alpha so masked pixels stay transparent", () => {
    for (const shader of [SHADERS.glow, SHADERS.beam]) {
      expect(shader).toContain("half3(signalColor) * alpha");
    }
    expect(SHADERS.radar).toContain("half3 rgb =");
    expect(SHADERS.radar).toContain("* alpha;");
  });

  it("composes a configurable radar with sweep and 32 echo slots", () => {
    expect(SHADERS.radar).toContain("sweepPhase");
    expect(SHADERS.radar).toContain("sweepType");
    expect(SHADERS.radar).toContain("sweepEnabled = step(-0.5, sweepType)");
    expect(SHADERS.radar).toContain("echoStyle");
    expect(SHADERS.radar).toContain("echoPosition0");
    expect(SHADERS.radar).toContain("echoPosition31");
    expect(SHADERS.radar).toContain("echoSize31");
    expect(SHADERS.radar).toContain("echoRune31");
    expect(SHADERS.radar).toContain("echoColor31");
    expect(SHADERS.radar).toContain("float runeSegment");
    expect(SHADERS.radar).toContain("float runeDistance");
    expect(SHADERS.radar).toContain("echoRuneCore31");
    expect(SHADERS.radar).toContain("echoRuneGlow31");
    expect(SHADERS.radar).toContain("vec3 echoBaseColor");
    expect(SHADERS.radar).toContain("vec3 sweepActiveColor");
    expect(SHADERS.radar).toContain("vec3 echoActiveColor");
    expect(SHADERS.radar).toContain("glyph < 8.5");
    expect(SHADERS.radar).toContain("decorationMode");
    expect(SHADERS.radar).toContain("ringDistance");
    expect(SHADERS.radar).toContain("innerBand");
    expect(SHADERS.radar).toContain("innerSegmentAngle");
    expect(SHADERS.radar).toContain("outerSegmentAngle");
    expect(SHADERS.radar).toContain("step(0.30");
    expect(SHADERS.radar).toContain("modernThinRings");
    expect(SHADERS.radar).toContain("modernOuterRing");
    expect(SHADERS.radar).toContain("modernVertical");
    expect(SHADERS.radar).toContain("modernTicks");
    expect(SHADERS.radar).toContain("localPixel * 0.45");
    expect(SHADERS.radar).toContain("localPixel * 0.8333");
    expect(SHADERS.radar).toContain("localPixel * 1.8333");
    expect(SHADERS.radar).toContain("float interlace");
    expect(SHADERS.radar).toContain("floor(coord.y)");
    expect(SHADERS.radar).toContain("arcaneOuterRing");
    expect(SHADERS.radar).toContain("arcaneInnerRing");
    expect(SHADERS.radar).toContain("arcaneSquare0Point");
    expect(SHADERS.radar).toContain("arcaneSquare30Point");
    expect(SHADERS.radar).toContain("arcaneSquare60Point");
    expect(SHADERS.radar).toContain("float crtEnabled = m314Enabled + modernEnabled");
    expect(SHADERS.radar).toContain("mix(1.0, interlace, crtEnabled)");
    expect(SHADERS.radar).toContain("trailEnabled");
    expect(SHADERS.radar).toContain("trailDistance");
    expect(SHADERS.radar).toContain("trailSpan = 0.5 * trailEnabled");
    expect(SHADERS.radar).toContain("log(1.0 + 9.0 * trailProgress)");
    expect(SHADERS.radar).toContain("mix(signalColor, vec3(1.0)");
    expect(SHADERS.radar).toContain("echoColorWeight");
    expect(SHADERS.radar).toContain("trail * trailFade");
    expect(SHADERS.radar).toContain("brightness * sweepColorWeight");
    expect(SHADERS.radar).toContain("brightness * echoColorMix");
    expect(SHADERS.radar).not.toContain("float background");
    expect(SHADERS.radar).toContain("squareDistance");
    expect(SHADERS.radar).toContain("effectRotation");
  });

  it("composes a static grid visualization with 32 world-space marker slots", () => {
    expect(SHADERS.grid).toContain("markerDataA0");
    expect(SHADERS.grid).toContain("markerDataA31");
    expect(SHADERS.grid).toContain("markerDataB31");
    expect(SHADERS.grid).toContain("markerDataC31");
    expect(SHADERS.grid).toContain("markerDataD31");
    expect(SHADERS.grid).toContain("markerColor31");
    expect(SHADERS.grid).toContain("worldOrigin");
    expect(SHADERS.grid).toContain("worldRange");
    expect(SHADERS.grid).toContain("squareGrid");
    expect(SHADERS.grid).toContain("hexGrid");
    expect(SHADERS.grid).toContain("isoGrid");
    expect(SHADERS.grid).toContain("gridStroke(float distanceToLine)");
    expect(SHADERS.grid).toContain("smoothstep(3.0, 6.0");
    expect(SHADERS.grid).toContain("markerRectFeather0");
    expect(SHADERS.grid).toContain("markerRectScale31 * spread * 0.12");
    expect(SHADERS.grid).toContain("spread <= 0.0 ? step(markerRectDistance0");
    expect(SHADERS.grid).not.toContain("sweepPhase");
  });


  it("lets glow range from a crisp ring to a soft aura", () => {
    expect(SHADERS.glow).toContain("innerFade");
    expect(SHADERS.glow).toContain("innerRadius <= 0.0001");
    expect(SHADERS.glow).toContain("centerOffset");
    expect(SHADERS.glow).toContain("effectSize");
    expect(SHADERS.glow).toContain("effectRotation");
    expect(SHADERS.glow).toContain("0.005");
    expect(SHADERS.glow).toContain("0.45");
    expect(SHADERS.glow).toContain("spread <= 0.0");
    expect(SHADERS.glow).toContain("step(innerRadius");
  });

  it("masks segmented glows in effect-local angular wedges", () => {
    expect(SHADERS.glow).toContain("uniform float segmentCount");
    expect(SHADERS.glow).toContain("uniform float segmentAlignment");
    expect(SHADERS.glow).toContain("uniform vec2 signalDirection");
    expect(SHADERS.glow).toContain("if (segmentCount > 1.5)");
    expect(SHADERS.glow).toContain("floor(mod(signalAngle + alignmentOffset, TAU) / wedgeWidth)");
    expect(SHADERS.glow).toContain("angularFeather");
  });

  it("supports opacity, flicker, and directional radial animation on glow and beam", () => {
    for (const shader of [SHADERS.glow, SHADERS.beam]) {
      expect(shader).toContain("animationMode");
      expect(shader).toContain("sin(time * rate");
      expect(shader).toContain("float noise");
      expect(shader).toContain("radialDirection");
      expect(shader).toContain("waveWidth");
      expect(shader).toContain("distanceFromCenter - innerRadius");
      expect(shader).toContain("shapeMode");
      expect(shader).toContain("squareDistance");
    }
  });

  it("aims the beam with direction and angular width uniforms", () => {
    expect(SHADERS.beam).toContain("beamDirection");
    expect(SHADERS.beam).toContain("beamWidth");
    expect(SHADERS.beam).toContain("angularDistance");
  });

  it("tapers an optional target-relative origin width toward the beam end", () => {
    expect(SHADERS.beam).toContain("beamOriginWidth");
    expect(SHADERS.beam).toContain("beamProgress");
    expect(SHADERS.beam).toContain("originHalfWidth");
    expect(SHADERS.beam).toContain("expandedHalfWidth");
    expect(SHADERS.beam).toContain("spread <= 0.0");
    expect(SHADERS.beam).toContain("step(expandedHalfWidth");
    expect(SHADERS.beam).toContain("forwardDistance / max(outerRadius");
    expect(SHADERS.beam).not.toContain("(forwardDistance - innerRadius)");
  });
});

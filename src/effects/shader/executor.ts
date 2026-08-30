import OBR, { buildEffect, type BoundingBox, type Effect } from "@owlbear-rodeo/sdk";
import { LOCAL_EFFECT_KEY } from "../../constants";
import type { DesiredEffect, ShaderEffectDefinitionV1, StrengthLinkDirection } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";
import { resolveShaderGeometry } from "./geometry";
import { SHADERS } from "./shaders";
import { stableEffectZIndex } from "./zIndex";

interface RuntimeState {
  localItemId: string;
  strength: number;
  configHash: string;
  preset: ShaderEffectDefinitionV1["preset"];
  layoutHash: string;
}

const EPSILON = 0.005;

export function resolveStrengthLinkedValue(value: number, link: StrengthLinkDirection | undefined, strength: number, min: number, max: number): number {
  if (!link) return value;
  const clampedStrength = Math.max(0, Math.min(1, strength));
  const lowStrengthValue = link === "max" ? min : max;
  return lowStrengthValue + (value - lowStrengthValue) * clampedStrength;
}

export function resolveStrengthLinkedRate(rate: number, link: StrengthLinkDirection | undefined, strength: number): number {
  return resolveStrengthLinkedValue(rate, link, strength, 0, 10);
}

function colorVector(hex: string) {
  return {
    x: Number.parseInt(hex.slice(1, 3), 16) / 255,
    y: Number.parseInt(hex.slice(3, 5), 16) / 255,
    z: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

export function resolveStrengthLinkedShaderValues(effect: ShaderEffectDefinitionV1, strength: number) {
  const configured = resolveShaderGeometry(effect);
  const geometry = {
    ...configured,
    offsetX: resolveStrengthLinkedValue(configured.offsetX, configured.offsetXStrengthLink, strength, -100, 100),
    offsetY: resolveStrengthLinkedValue(configured.offsetY, configured.offsetYStrengthLink, strength, -100, 100),
    width: resolveStrengthLinkedValue(configured.width, configured.widthStrengthLink, strength, 5, 400),
    height: resolveStrengthLinkedValue(configured.height, configured.heightStrengthLink, strength, 5, 400),
    rotation: resolveStrengthLinkedValue(configured.rotation, configured.rotationStrengthLink, strength, -180, 180),
    innerRadius: resolveStrengthLinkedValue(configured.innerRadius, configured.innerRadiusStrengthLink, strength, 0, Math.max(0, configured.outerRadius - 1)),
    outerRadius: resolveStrengthLinkedValue(configured.outerRadius, configured.outerRadiusStrengthLink, strength, configured.innerRadius + 1, 200),
  };
  geometry.outerRadius = Math.min(200, Math.max(geometry.innerRadius + 1, geometry.outerRadius));
  geometry.innerRadius = Math.min(geometry.innerRadius, geometry.outerRadius - 1);
  return {
    geometry,
    spread: resolveStrengthLinkedValue(effect.spread, effect.spreadStrengthLink, strength, 0.05, 4),
    beamWidth: resolveStrengthLinkedValue(effect.beamWidth ?? 38, effect.beamWidthStrengthLink, strength, 5, 120),
  };
}

function effectScale(effect: ShaderEffectDefinitionV1, resolved: ReturnType<typeof resolveStrengthLinkedShaderValues>): number {
  const { geometry } = resolved;
  const feather = effect.preset === "beam"
    ? Math.min(0.12, Math.max(0.008, 0.025 * resolved.spread))
    : Math.min(0.45, Math.max(0.005, 0.1 * resolved.spread));
  const axisScale = Math.max(geometry.width, geometry.height) / 100;
  const offsetScale = Math.max(Math.abs(geometry.offsetX), Math.abs(geometry.offsetY)) / 100;
  return Math.max(1, geometry.outerRadius / 100 * axisScale + offsetScale + feather);
}

function layout(bounds: BoundingBox, scale: number) {
  const width = Math.max(1, bounds.width * scale);
  const height = Math.max(1, bounds.height * scale);
  return {
    width,
    height,
    position: { x: bounds.center.x - width / 2, y: bounds.center.y - height / 2 },
  };
}

export function shaderUniforms(effect: ShaderEffectDefinitionV1, strength: number, scale: number, direction: { x: number; y: number }, resolved = resolveStrengthLinkedShaderValues(effect, strength)) {
  const { geometry } = resolved;
  const animationModes = { none: 0, pulse: 1, flicker: 2, "radial-pulse": 3 } as const;
  const values = [
    { name: "signalColor", value: colorVector(effect.color) },
    { name: "strength", value: strength * effect.maxIntensity },
    { name: "rate", value: resolveStrengthLinkedRate(effect.animation?.rate ?? 1, effect.animation?.rateStrengthLink, strength) },
    { name: "depth", value: resolveStrengthLinkedValue(effect.animation?.depth ?? 0, effect.animation?.depthStrengthLink, strength, 0, 1) },
    { name: "animationMode", value: animationModes[effect.animation?.mode ?? "none"] },
    { name: "radialDirection", value: effect.animation?.radialDirection === "inward" ? -1 : 1 },
    { name: "waveWidth", value: resolveStrengthLinkedValue(effect.animation?.waveWidth ?? 0.22, effect.animation?.waveWidthStrengthLink, strength, 0.05, 1) },
    { name: "spread", value: resolved.spread },
    { name: "shapeMode", value: effect.shape === "square" ? 1 : 0 },
    { name: "centerOffset", value: { x: geometry.offsetX / 100 / scale, y: geometry.offsetY / 100 / scale } },
    { name: "innerRadius", value: geometry.innerRadius / 100 / scale },
    { name: "outerRadius", value: geometry.outerRadius / 100 / scale },
    { name: "effectSize", value: { x: geometry.width / 100, y: geometry.height / 100 } },
    { name: "effectRotation", value: geometry.rotation * Math.PI / 180 },
  ];
  if (effect.preset === "beam") {
    const localDirection = {
      x: direction.x / (geometry.width / 100),
      y: direction.y / (geometry.height / 100),
    };
    const localDirectionLength = Math.hypot(localDirection.x, localDirection.y) || 1;
    values.push({ name: "beamDirection", value: { x: localDirection.x / localDirectionLength, y: localDirection.y / localDirectionLength } });
    values.push({ name: "beamWidth", value: resolved.beamWidth });
  }
  return values;
}

export function shaderConfigHash(effect: ShaderEffectDefinitionV1): string {
  return JSON.stringify([effect.preset, effect.shape, effect.placement, effect.color, effect.maxIntensity, effect.spread, effect.spreadStrengthLink, effect.geometry, effect.beamWidth, effect.beamWidthStrengthLink, effect.animation]);
}

export function shaderZIndexForTarget(targetZIndex: number, runtimeKey: string, placement: ShaderEffectDefinitionV1["placement"]): number {
  const tieBreak = (stableEffectZIndex(runtimeKey) - 1_000_000) / 1_000_000;
  const offset = 0.5 + tieBreak * 0.49;
  return targetZIndex + (placement === "above" ? offset : -offset);
}

export class ShaderEffectExecutor implements EffectExecutor<ShaderEffectDefinitionV1> {
  readonly type = "shader" as const;
  readonly scope = "local" as const;
  private states = new Map<string, RuntimeState>();
  private initialized = false;

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const desired = batch.desired;
    if (!this.initialized) {
      const stale = (await OBR.scene.local.getItems()).filter((item) => item.metadata[LOCAL_EFFECT_KEY] !== undefined);
      if (stale.length) await OBR.scene.local.deleteItems(stale.map((item) => item.id));
      this.initialized = true;
    }
    const active = new Set(desired.map((entry) => entry.runtimeKey));
    const obsolete = [...this.states.entries()].filter(([key]) => !active.has(key));
    if (obsolete.length) {
      await OBR.scene.local.deleteItems(obsolete.map(([, state]) => state.localItemId));
      for (const [key] of obsolete) this.states.delete(key);
    }

    for (const context of desired) {
      const effect = context.effect as ShaderEffectDefinitionV1;
      const bounds = await OBR.scene.items.getItemBounds([context.target!.id]);
      const aimTarget = context.detectedEmitter?.id === context.target!.id ? context.detector : context.detectedEmitter;
      const aimBounds = aimTarget ? await OBR.scene.items.getItemBounds([aimTarget.id]) : bounds;
      const directionVector = {
        x: (aimBounds.center.x - bounds.center.x) / Math.max(bounds.width / 2, 1),
        y: (aimBounds.center.y - bounds.center.y) / Math.max(bounds.height / 2, 1),
      };
      const directionLength = Math.hypot(directionVector.x, directionVector.y) || 1;
      const direction = { x: directionVector.x / directionLength, y: directionVector.y / directionLength };
      const resolved = resolveStrengthLinkedShaderValues(effect, context.strength);
      const scale = effectScale(effect, resolved);
      const effectLayout = layout(bounds, scale);
      const effectZIndex = shaderZIndexForTarget(context.target!.zIndex, context.runtimeKey, effect.placement);
      const effectLayer = context.target!.layer;
      const nextLayoutHash = JSON.stringify([effectLayout, direction]);
      const hash = shaderConfigHash(effect);
      let existing = this.states.get(context.runtimeKey);
      // Owlbear does not reliably recompile SkSL when an existing Effect item's
      // source changes. Recreate on preset changes; uniform-only changes stay fast.
      if (existing && existing.preset !== effect.preset) {
        await OBR.scene.local.deleteItems([existing.localItemId]);
        this.states.delete(context.runtimeKey);
        existing = undefined;
      }
      if (!existing) {
        const item = buildEffect()
          .name(`Proximity Signal: ${effect.preset}`)
          .effectType("STANDALONE")
          .width(effectLayout.width)
          .height(effectLayout.height)
          .position(effectLayout.position)
          // Keep the local overlay in Owlbear's attachment graph so the native
          // movement interaction carries it with the target before the scene
          // item change is committed. Scale and rotation remain world-aligned;
          // the next reconciliation recalculates their exact layout.
          .attachedTo(context.target!.id)
          .disableAttachmentBehavior(["SCALE", "ROTATION"])
          .zIndex(effectZIndex)
          .sksl(SHADERS[effect.preset])
          .uniforms(shaderUniforms(effect, context.strength, scale, direction, resolved))
          .blendMode("SRC_OVER")
          .locked(true)
          .disableHit(true)
          .disableAutoZIndex(true)
          .layer(effectLayer)
          .metadata({ [LOCAL_EFFECT_KEY]: { runtimeKey: context.runtimeKey } })
          .build();
        await OBR.scene.local.addItems([item]);
        this.states.set(context.runtimeKey, { localItemId: item.id, strength: context.strength, configHash: hash, preset: effect.preset, layoutHash: nextLayoutHash });
      } else if (Math.abs(existing.strength - context.strength) >= EPSILON || existing.configHash !== hash || existing.layoutHash !== nextLayoutHash) {
        await OBR.scene.local.updateItems<Effect>([existing.localItemId], (items) => {
          for (const item of items) {
            item.width = effectLayout.width;
            item.height = effectLayout.height;
            item.position = effectLayout.position;
            item.zIndex = effectZIndex;
            item.layer = effectLayer;
            item.uniforms = shaderUniforms(effect, context.strength, scale, direction, resolved);
          }
        });
        existing.strength = context.strength;
        existing.configHash = hash;
        existing.layoutHash = nextLayoutHash;
      }
    }
    return {
      localIds: new Map([...this.states].map(([key, state]) => [key, state.localItemId])),
      statuses: new Map([...this.states].map(([key]) => [key, "active"])),
    };
  }

  async clear(): Promise<void> {
    const ids = [...this.states.values()].map((state) => state.localItemId);
    if (ids.length) await OBR.scene.local.deleteItems(ids);
    this.states.clear();
    this.initialized = false;
  }
}

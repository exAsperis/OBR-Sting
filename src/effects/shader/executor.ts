import OBR, { buildEffect, type BoundingBox, type Effect } from "@owlbear-rodeo/sdk";
import { LOCAL_EFFECT_KEY } from "../../constants";
import type { DesiredEffect, ShaderEffectDefinitionV1 } from "../../types";
import type { EffectExecutor } from "../registry";
import { resolveShaderGeometry } from "./geometry";
import { SHADERS } from "./shaders";

interface RuntimeState {
  localItemId: string;
  strength: number;
  configHash: string;
  preset: ShaderEffectDefinitionV1["preset"];
  layoutHash: string;
}

const EPSILON = 0.005;

function colorVector(hex: string) {
  return {
    x: Number.parseInt(hex.slice(1, 3), 16) / 255,
    y: Number.parseInt(hex.slice(3, 5), 16) / 255,
    z: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

function effectScale(effect: ShaderEffectDefinitionV1): number {
  const geometry = resolveShaderGeometry(effect);
  const feather = effect.preset === "outline"
    ? Math.min(0.07, Math.max(0.005, 0.012 * effect.spread))
    : Math.min(0.45, Math.max(0.02, 0.1 * effect.spread));
  return Math.max(1, geometry.outerRadius / 100 + feather);
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

function uniforms(effect: ShaderEffectDefinitionV1, strength: number, scale: number, direction: { x: number; y: number }) {
  const geometry = resolveShaderGeometry(effect);
  const values = [
    { name: "signalColor", value: colorVector(effect.color) },
    { name: "strength", value: strength * effect.maxIntensity },
    { name: "rate", value: effect.animation?.rate ?? 1 },
    { name: "depth", value: effect.animation?.depth ?? 0 },
    { name: "spread", value: effect.spread },
    { name: "centerOffset", value: { x: geometry.offsetX / 100 / scale, y: geometry.offsetY / 100 / scale } },
    { name: "innerRadius", value: geometry.innerRadius / 100 / scale },
    { name: "outerRadius", value: geometry.outerRadius / 100 / scale },
  ];
  if (effect.preset === "beam") {
    values.push({ name: "beamDirection", value: direction });
    values.push({ name: "beamWidth", value: effect.beamWidth ?? 38 });
  }
  return values;
}

function configHash(effect: ShaderEffectDefinitionV1): string {
  return JSON.stringify([effect.preset, effect.color, effect.maxIntensity, effect.spread, effect.geometry, effect.beamWidth, effect.animation]);
}

export class ShaderEffectExecutor implements EffectExecutor<ShaderEffectDefinitionV1> {
  readonly type = "shader" as const;
  readonly scope = "local" as const;
  private states = new Map<string, RuntimeState>();
  private initialized = false;

  async reconcile(desired: DesiredEffect[]): Promise<Map<string, string>> {
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
      const scale = effectScale(effect);
      const effectLayout = layout(bounds, scale);
      const nextLayoutHash = JSON.stringify([effectLayout, direction]);
      const hash = configHash(effect);
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
          .sksl(SHADERS[effect.preset])
          .uniforms(uniforms(effect, context.strength, scale, direction))
          .blendMode("SRC_OVER")
          .locked(true)
          .disableHit(true)
          .disableAutoZIndex(true)
          .layer("ATTACHMENT")
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
            item.uniforms = uniforms(effect, context.strength, scale, direction);
          }
        });
        existing.strength = context.strength;
        existing.configHash = hash;
        existing.layoutHash = nextLayoutHash;
      }
    }
    return new Map([...this.states].map(([key, state]) => [key, state.localItemId]));
  }

  async clear(): Promise<void> {
    const ids = [...this.states.values()].map((state) => state.localItemId);
    if (ids.length) await OBR.scene.local.deleteItems(ids);
    this.states.clear();
    this.initialized = false;
  }
}

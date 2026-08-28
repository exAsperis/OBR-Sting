import OBR, { buildEffect, type Effect } from "@owlbear-rodeo/sdk";
import { LOCAL_EFFECT_KEY } from "../../constants";
import type { DesiredEffect, ShaderEffectDefinitionV1 } from "../../types";
import type { EffectExecutor } from "../registry";
import { SHADERS } from "./shaders";

interface RuntimeState {
  localItemId: string;
  strength: number;
  configHash: string;
}

const EPSILON = 0.005;

function colorVector(hex: string) {
  return {
    x: Number.parseInt(hex.slice(1, 3), 16) / 255,
    y: Number.parseInt(hex.slice(3, 5), 16) / 255,
    z: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

function uniforms(effect: ShaderEffectDefinitionV1, strength: number) {
  return [
    { name: "signalColor", value: colorVector(effect.color) },
    { name: "strength", value: strength * effect.maxIntensity },
    { name: "rate", value: effect.animation?.rate ?? 1 },
    { name: "depth", value: effect.animation?.depth ?? 0 },
    { name: "spread", value: effect.spread },
  ];
}

function configHash(effect: ShaderEffectDefinitionV1): string {
  return JSON.stringify([effect.preset, effect.color, effect.maxIntensity, effect.spread, effect.animation]);
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
      const hash = configHash(effect);
      const existing = this.states.get(context.runtimeKey);
      if (!existing) {
        const item = buildEffect()
          .name(`Proximity Signal: ${effect.preset}`)
          .effectType("ATTACHMENT")
          .sksl(SHADERS[effect.preset])
          .uniforms(uniforms(effect, context.strength))
          .blendMode("SRC_OVER")
          .locked(true)
          .disableHit(true)
          .disableAutoZIndex(true)
          .layer("POST_PROCESS")
          .attachedTo(context.target!.id)
          .metadata({ [LOCAL_EFFECT_KEY]: { runtimeKey: context.runtimeKey } })
          .build();
        await OBR.scene.local.addItems([item]);
        this.states.set(context.runtimeKey, { localItemId: item.id, strength: context.strength, configHash: hash });
      } else if (Math.abs(existing.strength - context.strength) >= EPSILON || existing.configHash !== hash) {
        await OBR.scene.local.updateItems<Effect>([existing.localItemId], (items) => {
          for (const item of items) {
            item.sksl = SHADERS[effect.preset];
            item.uniforms = uniforms(effect, context.strength);
          }
        }, true);
        existing.strength = context.strength;
        existing.configHash = hash;
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

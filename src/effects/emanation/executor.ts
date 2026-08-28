import OBR from "@owlbear-rodeo/sdk";
import { EMANATION_INTEGRATION_KEY, EMANATION_MESSAGE_CHANNEL } from "../../constants";
import type { DesiredEffect, EmanationEffectDefinitionV1 } from "../../types";
import type { EffectExecutor } from "../registry";

interface RuntimeState {
  targetId: string;
  presetName: string;
  removeAllOnDeactivate: boolean;
}

function integrationEnabled(): boolean {
  return localStorage.getItem(EMANATION_INTEGRATION_KEY) === "true";
}

async function createAura(targetId: string, presetName: string): Promise<void> {
  await OBR.broadcast.sendMessage(EMANATION_MESSAGE_CHANNEL, {
    type: "CREATE_AURAS_PRESETS",
    sources: [targetId],
    presets: [presetName],
  }, { destination: "LOCAL" });
}

async function removeAuras(targetId: string): Promise<void> {
  await OBR.broadcast.sendMessage(EMANATION_MESSAGE_CHANNEL, {
    type: "REMOVE_AURAS",
    sources: [targetId],
  }, { destination: "LOCAL" });
}

export class EmanationEffectExecutor implements EffectExecutor<EmanationEffectDefinitionV1> {
  readonly type = "emanation" as const;
  readonly scope = "shared" as const;
  private states = new Map<string, RuntimeState>();

  async reconcile(desired: DesiredEffect[]): Promise<Map<string, string>> {
    const enabled = integrationEnabled();
    const applicable = enabled ? desired : [];
    const active = new Set(applicable.map((entry) => entry.runtimeKey));

    for (const [key, state] of [...this.states]) {
      if (active.has(key)) continue;
      if (state.removeAllOnDeactivate) await removeAuras(state.targetId);
      this.states.delete(key);
    }

    for (const context of applicable) {
      const effect = context.effect as EmanationEffectDefinitionV1;
      const existing = this.states.get(context.runtimeKey);
      if (existing && existing.targetId === context.target!.id && existing.presetName === effect.presetName) {
        existing.removeAllOnDeactivate = effect.removeAllOnDeactivate;
        continue;
      }
      if (existing?.removeAllOnDeactivate) await removeAuras(existing.targetId);
      await createAura(context.target!.id, effect.presetName);
      this.states.set(context.runtimeKey, {
        targetId: context.target!.id,
        presetName: effect.presetName,
        removeAllOnDeactivate: effect.removeAllOnDeactivate,
      });
    }

    return new Map([...this.states].map(([key]) => [key, `emanation:${key}`]));
  }

  async clear(): Promise<void> {
    for (const state of this.states.values()) if (state.removeAllOnDeactivate) await removeAuras(state.targetId);
    this.states.clear();
  }
}

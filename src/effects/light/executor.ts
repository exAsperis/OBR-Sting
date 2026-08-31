import OBR, { buildLight, isLight, type Light, type LightType } from "@owlbear-rodeo/sdk";
import { LOCAL_LIGHT_KEY } from "../../constants";
import { sceneToWorldUnits } from "../../proximity/distance";
import type { DesiredEffect, LightDynamicValueV1, LightEffectDefinitionV1 } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";

export interface MutableLightState {
  attenuationRadius: number;
  sourceRadius: number;
  falloff: number;
  innerAngle: number;
  outerAngle: number;
  lightType: LightType;
}

interface AddedState { localItemId: string; configHash: string; permanent: boolean }
interface ModifiedState { base: MutableLightState; applied: MutableLightState }

const snapshot = (light: Light): MutableLightState => ({
  attenuationRadius: light.attenuationRadius, sourceRadius: light.sourceRadius, falloff: light.falloff,
  innerAngle: light.innerAngle, outerAngle: light.outerAngle, lightType: light.lightType,
});
const equal = (a: MutableLightState, b: MutableLightState) => JSON.stringify(a) === JSON.stringify(b);
const resolve = (field: LightDynamicValueV1 | undefined, strength: number, fallback: number) => {
  if (!field) return fallback;
  if (!field.range || field.range.enabled === false) return field.value;
  const t = Math.max(0, Math.min(1, strength));
  return field.range.minimum + (field.range.maximum - field.range.minimum) * t;
};
const ownerKey = (context: DesiredEffect) => JSON.stringify([context.detector.id, context.rule.id, context.effect.id, context.target?.id]);
export const shouldRetainInactiveAddedLight = (state: Pick<AddedState, "permanent">): boolean => state.permanent;

export function applyLightModifiers(base: MutableLightState, contexts: DesiredEffect[], toWorld: (value: number) => number): MutableLightState {
  const result = { ...base };
  for (const context of [...contexts].sort((a, b) => a.runtimeKey.localeCompare(b.runtimeKey))) {
    const effect = context.effect as LightEffectDefinitionV1;
    const configuredRadius = resolve(effect.attenuationRadius, context.strength, 0);
    result.attenuationRadius = effect.radiusOperation === "add" ? result.attenuationRadius + toWorld(configuredRadius)
      : effect.radiusOperation === "multiply" ? result.attenuationRadius * configuredRadius : toWorld(configuredRadius);
    if (effect.sourceRadius) result.sourceRadius = toWorld(resolve(effect.sourceRadius, context.strength, result.sourceRadius));
    if (effect.falloff) result.falloff = resolve(effect.falloff, context.strength, result.falloff);
    if (effect.innerAngle) result.innerAngle = resolve(effect.innerAngle, context.strength, result.innerAngle);
    if (effect.outerAngle) result.outerAngle = resolve(effect.outerAngle, context.strength, result.outerAngle);
    if (effect.lightType) result.lightType = effect.lightType;
  }
  result.attenuationRadius = Math.max(0, result.attenuationRadius);
  result.sourceRadius = Math.max(0, result.sourceRadius);
  result.innerAngle = Math.max(0, Math.min(360, result.innerAngle));
  result.outerAngle = Math.max(result.innerAngle, Math.min(360, result.outerAngle));
  return result;
}

export class LightEffectExecutor implements EffectExecutor<LightEffectDefinitionV1> {
  readonly type = "light" as const;
  readonly scope = "local" as const;
  private added = new Map<string, AddedState>();
  private modified = new Map<string, ModifiedState>();
  private initialized = false;

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const localIds = new Map<string, string>(), statuses = new Map<string, string>();
    if (!this.initialized) {
      const stale = (await OBR.scene.local.getItems()).filter((item) => item.metadata[LOCAL_LIGHT_KEY] !== undefined);
      if (stale.length) await OBR.scene.local.deleteItems(stale.map((item) => item.id));
      this.initialized = true;
    }
    const [dpi, scale] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale()]);
    const toWorld = (value: number) => sceneToWorldUnits(value, dpi, scale.parsed.multiplier);
    const addGroups = new Map<string, DesiredEffect[]>(), modifyGroups = new Map<string, DesiredEffect[]>();
    for (const context of batch.desired.filter((entry) => entry.effect.type === "light")) {
      const effect = context.effect as LightEffectDefinitionV1;
      const map = effect.action === "add" ? addGroups : modifyGroups;
      const key = effect.action === "add" ? ownerKey(context) : context.target?.id ?? ownerKey(context);
      map.set(key, [...(map.get(key) ?? []), context]);
    }

    for (const [key, state] of [...this.added]) if (!addGroups.has(key)) {
      if (shouldRetainInactiveAddedLight(state)) continue;
      try { await OBR.scene.local.deleteItems([state.localItemId]); } catch { /* already gone */ }
      this.added.delete(key);
    }
    for (const [key, contexts] of addGroups) {
      const context = [...contexts].sort((a, b) => b.strength - a.strength || a.runtimeKey.localeCompare(b.runtimeKey))[0];
      const effect = context.effect as LightEffectDefinitionV1, target = context.target!;
      const values = applyLightModifiers({ attenuationRadius: 0, sourceRadius: 0, falloff: 0.5, innerAngle: 360, outerAngle: 360, lightType: "PRIMARY" }, [context], toWorld);
      const rotation = effect.rotationBehavior === "fixed" ? effect.rotation ?? 0 : target.rotation;
      const hash = JSON.stringify([target.id, target.position, rotation, values, effect.duration ?? "temporary"]);
      let state = this.added.get(key);
      if (!state) {
        const light = buildLight().name("Sting light").position(target.position).rotation(rotation).attachedTo(target.id)
          .attenuationRadius(values.attenuationRadius).sourceRadius(values.sourceRadius).falloff(values.falloff)
          .innerAngle(values.innerAngle).outerAngle(values.outerAngle).lightType(values.lightType)
          .metadata({ [LOCAL_LIGHT_KEY]: { ownerKey: key, effectId: effect.id, duration: effect.duration ?? "temporary" } }).build();
        await OBR.scene.local.addItems([light]); state = { localItemId: light.id, configHash: hash, permanent: effect.duration === "permanent" }; this.added.set(key, state);
      } else if (state.configHash !== hash) {
        await OBR.scene.local.updateItems<Light>([state.localItemId], (items) => { for (const light of items) {
          light.position = target.position; light.rotation = rotation; Object.assign(light, values);
          light.metadata[LOCAL_LIGHT_KEY] = { ownerKey: key, effectId: effect.id, duration: effect.duration ?? "temporary" };
        }}); state.configHash = hash; state.permanent = effect.duration === "permanent";
      }
      for (const entry of contexts) { localIds.set(entry.runtimeKey, state.localItemId); statuses.set(entry.runtimeKey, "active"); }
    }

    for (const [lightId, state] of [...this.modified]) if (!modifyGroups.has(lightId)) {
      try { await OBR.scene.local.updateItems<Light>([lightId], (items) => { for (const light of items) Object.assign(light, state.base); }); } catch { /* foreign owner may have removed it */ }
      this.modified.delete(lightId);
    }
    for (const [lightId, contexts] of modifyGroups) {
      const light = contexts[0].target;
      if (!light || !isLight(light)) { for (const context of contexts) statuses.set(context.runtimeKey, "target-not-light"); continue; }
      // Cross-extension local-item mutation is not documented as an ownership
      // guarantee and remains unverified in the live compatibility spike.
      if (light.metadata[LOCAL_LIGHT_KEY] === undefined) {
        for (const context of contexts) statuses.set(context.runtimeKey, "external-modification-unverified");
        continue;
      }
      let state = this.modified.get(lightId);
      const observed = snapshot(light);
      if (!state) state = { base: observed, applied: observed };
      else if (!equal(observed, state.applied)) state.base = observed;
      const desired = applyLightModifiers(state.base, contexts, toWorld);
      if (!equal(desired, observed)) await OBR.scene.local.updateItems<Light>([lightId], (items) => { for (const item of items) Object.assign(item, desired); });
      state.applied = desired; this.modified.set(lightId, state);
      for (const context of contexts) { localIds.set(context.runtimeKey, lightId); statuses.set(context.runtimeKey, "modified-owned"); }
    }
    return { localIds, statuses };
  }

  async clear(): Promise<void> {
    if (this.added.size) { try { await OBR.scene.local.deleteItems([...this.added.values()].map((state) => state.localItemId)); } catch { /* scene closed */ } }
    for (const [id, state] of this.modified) { try { await OBR.scene.local.updateItems<Light>([id], (items) => { for (const light of items) Object.assign(light, state.base); }); } catch { /* scene closed or foreign item removed */ } }
    this.added.clear(); this.modified.clear(); this.initialized = false;
  }
}

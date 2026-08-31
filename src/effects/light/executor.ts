import OBR, { buildLight, isLight, type Light, type LightType } from "@owlbear-rodeo/sdk";
import { DYNAMIC_FOG_LIGHT_KEY, LOCAL_LIGHT_KEY } from "../../constants";
import { sceneToWorldUnits } from "../../proximity/distance";
import type { DesiredEffect, LightDynamicValueV1, LightEffectDefinitionV1 } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";

export interface MutableLightState { attenuationRadius: number; sourceRadius: number; falloff: number; innerAngle: number; outerAngle: number; lightType: LightType }
interface AddedState { localItemId: string; configHash: string }
interface ModifiedState { base: MutableLightState; applied: MutableLightState; contexts: DesiredEffect[]; attachedTo?: string }

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const snapshot = (light: Light): MutableLightState => ({ attenuationRadius: light.attenuationRadius, sourceRadius: light.sourceRadius, falloff: light.falloff, innerAngle: light.innerAngle, outerAngle: light.outerAngle, lightType: light.lightType });
const equal = (a: MutableLightState, b: MutableLightState) => JSON.stringify(a) === JSON.stringify(b);
const resolve = (field: LightDynamicValueV1 | undefined, strength: number, fallback: number) => !field ? fallback : !field.range || field.range.enabled === false ? field.value : field.range.minimum + (field.range.maximum - field.range.minimum) * Math.max(0, Math.min(1, strength));
const ownerKey = (context: DesiredEffect) => JSON.stringify([context.detector.id, context.rule.id, context.effect.id, context.target?.id]);
const permanent = (context: DesiredEffect) => context.effect.type === "light" && context.effect.duration === "permanent";
export interface DynamicFogLightConfig extends MutableLightState { rotation?: number }

export function dynamicFogConfig(values: MutableLightState, rotation?: number): DynamicFogLightConfig {
  return { ...values, ...(rotation === undefined ? {} : { rotation }) };
}

async function persistDynamicFogLight(targetId: string, config: DynamicFogLightConfig): Promise<void> {
  await OBR.scene.items.updateItems([targetId], (items) => {
    for (const item of items) {
      if (JSON.stringify(item.metadata[DYNAMIC_FOG_LIGHT_KEY]) !== JSON.stringify(config)) {
        item.metadata[DYNAMIC_FOG_LIGHT_KEY] = config;
      }
    }
  });
}

export function applyLightModifiers(base: MutableLightState, contexts: DesiredEffect[], toWorld: (value: number) => number): MutableLightState {
  const result = { ...base };
  for (const context of [...contexts].sort((a, b) => a.runtimeKey.localeCompare(b.runtimeKey))) {
    const effect = context.effect as LightEffectDefinitionV1;
    const radius = resolve(effect.attenuationRadius, context.strength, 0);
    result.attenuationRadius = effect.radiusOperation === "add" ? result.attenuationRadius + toWorld(radius) : effect.radiusOperation === "multiply" ? result.attenuationRadius * radius : toWorld(radius);
    if (effect.sourceRadius) result.sourceRadius = toWorld(resolve(effect.sourceRadius, context.strength, result.sourceRadius));
    if (effect.falloff) result.falloff = resolve(effect.falloff, context.strength, result.falloff);
    if (effect.innerAngle) result.innerAngle = resolve(effect.innerAngle, context.strength, result.innerAngle);
    if (effect.outerAngle) result.outerAngle = resolve(effect.outerAngle, context.strength, result.outerAngle);
    if (effect.lightType) result.lightType = effect.lightType;
  }
  result.attenuationRadius = Math.max(0, result.attenuationRadius); result.sourceRadius = Math.max(0, result.sourceRadius);
  result.innerAngle = Math.max(0, Math.min(360, result.innerAngle)); result.outerAngle = Math.max(result.innerAngle, Math.min(360, result.outerAngle));
  return result;
}

export function lightsForTarget(context: Pick<DesiredEffect, "target" | "localLights">): Light[] {
  if (!context.target) return [];
  if (isLight(context.target)) return [context.target];
  return (context.localLights ?? []).filter((light) => light.attachedTo === context.target!.id);
}

export class LightEffectExecutor implements EffectExecutor<LightEffectDefinitionV1> {
  readonly type = "light" as const; readonly scope = "local" as const;
  private added = new Map<string, AddedState>(); private modified = new Map<string, ModifiedState>(); private initialized = false;

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const stale: string[] = [];
    for (const item of await OBR.scene.local.getItems()) {
      const metadata = item.metadata[LOCAL_LIGHT_KEY];
      if (!isLight(item) || !record(metadata)) continue;
      // Migrate permanent lights created by the earlier local-only implementation.
      if (metadata.duration === "permanent" && item.attachedTo) {
        try { await persistDynamicFogLight(item.attachedTo, dynamicFogConfig(snapshot(item))); } catch { /* target may no longer exist */ }
      }
      stale.push(item.id);
    }
    if (stale.length) await OBR.scene.local.deleteItems(stale);
    this.initialized = true;
  }

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const localIds = new Map<string, string>(), statuses = new Map<string, string>();
    await this.initialize();
    const [dpi, scale] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale()]);
    const toWorld = (value: number) => sceneToWorldUnits(value, dpi, scale.parsed.multiplier);
    const addGroups = new Map<string, DesiredEffect[]>(), modifyGroups = new Map<string, DesiredEffect[]>();
    for (const context of batch.desired.filter((entry) => entry.effect.type === "light")) {
      const effect = context.effect as LightEffectDefinitionV1;
      if (effect.action === "add") { const key = ownerKey(context); addGroups.set(key, [...(addGroups.get(key) ?? []), context]); continue; }
      const targets = lightsForTarget(context);
      if (!targets.length) statuses.set(context.runtimeKey, "target-has-no-light");
      for (const light of targets) modifyGroups.set(light.id, [...(modifyGroups.get(light.id) ?? []), { ...context, target: light }]);
    }

    for (const [key, state] of [...this.added]) if (!addGroups.has(key)) {
      try { await OBR.scene.local.deleteItems([state.localItemId]); } catch { /* already gone */ } this.added.delete(key);
    }
    for (const [key, contexts] of addGroups) {
      const context = [...contexts].sort((a, b) => b.strength - a.strength || a.runtimeKey.localeCompare(b.runtimeKey))[0];
      const effect = context.effect as LightEffectDefinitionV1, target = context.target!;
      const values = applyLightModifiers({ attenuationRadius: 0, sourceRadius: 0, falloff: 0.5, innerAngle: 360, outerAngle: 360, lightType: "PRIMARY" }, [context], toWorld);
      const rotation = effect.rotationBehavior === "fixed" ? effect.rotation ?? 0 : target.rotation, duration = effect.duration ?? "temporary";
      const hash = JSON.stringify([target.id, target.position, rotation, values, duration]); let state = this.added.get(key);
      if (duration === "permanent") {
        if (state) { try { await OBR.scene.local.deleteItems([state.localItemId]); } catch { /* already gone */ } this.added.delete(key); }
        try {
          const rotationOffset = effect.rotationBehavior === "fixed" ? rotation - target.rotation : undefined;
          await persistDynamicFogLight(target.id, dynamicFogConfig(values, rotationOffset));
          for (const entry of contexts) { localIds.set(entry.runtimeKey, target.id); statuses.set(entry.runtimeKey, "active-permanent"); }
        } catch {
          for (const entry of contexts) statuses.set(entry.runtimeKey, "permanent-light-denied");
        }
        continue;
      }
      if (!state) {
        const light = buildLight().name("Sting light").position(target.position).rotation(rotation).attachedTo(target.id).attenuationRadius(values.attenuationRadius).sourceRadius(values.sourceRadius).falloff(values.falloff).innerAngle(values.innerAngle).outerAngle(values.outerAngle).lightType(values.lightType).metadata({ [LOCAL_LIGHT_KEY]: { ownerKey: key, effectId: effect.id, duration } }).build();
        await OBR.scene.local.addItems([light]); state = { localItemId: light.id, configHash: hash }; this.added.set(key, state);
      } else if (state.configHash !== hash) {
        await OBR.scene.local.updateItems<Light>([state.localItemId], (items) => { for (const light of items) { light.position = target.position; light.rotation = rotation; Object.assign(light, values); light.metadata[LOCAL_LIGHT_KEY] = { ownerKey: key, effectId: effect.id, duration }; } });
        state.configHash = hash;
      }
      for (const entry of contexts) { localIds.set(entry.runtimeKey, state.localItemId); statuses.set(entry.runtimeKey, "active-temporary"); }
    }

    for (const [lightId, state] of [...this.modified]) if (!modifyGroups.has(lightId)) {
      state.base = applyLightModifiers(state.base, state.contexts.filter(permanent), toWorld);
      try { await OBR.scene.local.updateItems<Light>([lightId], (items) => { for (const light of items) Object.assign(light, state.base); }); } catch { /* removed with owner */ }
      if (state.contexts.some(permanent) && state.attachedTo) try { await persistDynamicFogLight(state.attachedTo, dynamicFogConfig(state.base)); } catch { /* target removed or update denied */ }
      this.modified.delete(lightId);
    }
    for (const [lightId, contexts] of modifyGroups) {
      const light = contexts[0].target as Light;
      let state = this.modified.get(lightId); const observed = snapshot(light);
      if (!state) state = { base: observed, applied: observed, contexts: [], attachedTo: light.attachedTo };
      else {
        const activeKeys = new Set(contexts.map((context) => context.runtimeKey));
        state.base = applyLightModifiers(state.base, state.contexts.filter((context) => permanent(context) && !activeKeys.has(context.runtimeKey)), toWorld);
        if (!equal(observed, state.applied)) state.base = observed;
      }
      const desired = applyLightModifiers(state.base, contexts, toWorld);
      if (!equal(desired, observed)) {
        try { await OBR.scene.local.updateItems<Light>([lightId], (items) => { for (const item of items) Object.assign(item, desired); }); }
        catch { for (const context of contexts) statuses.set(context.runtimeKey, "modification-denied"); continue; }
      }
      if (contexts.some(permanent)) {
        if (!state.attachedTo) { for (const context of contexts.filter(permanent)) statuses.set(context.runtimeKey, "permanent-target-unattached"); }
        else try { await persistDynamicFogLight(state.attachedTo, dynamicFogConfig(desired)); }
        catch { for (const context of contexts.filter(permanent)) statuses.set(context.runtimeKey, "permanent-light-denied"); }
      }
      state.applied = desired; state.contexts = contexts; this.modified.set(lightId, state);
      for (const context of contexts) {
        localIds.set(context.runtimeKey, lightId);
        if (!statuses.has(context.runtimeKey)) statuses.set(context.runtimeKey, permanent(context) ? "modified-permanent" : light.metadata[LOCAL_LIGHT_KEY] === undefined ? "modified-external-temporary" : "modified-temporary");
      }
    }
    return { localIds, statuses };
  }

  async clear(): Promise<void> {
    const temporaryIds = [...this.added.values()].map((state) => state.localItemId);
    if (temporaryIds.length) { try { await OBR.scene.local.deleteItems(temporaryIds); } catch { /* scene closed */ } }
    let dpi = 1, multiplier = 1;
    try { [dpi, multiplier] = await Promise.all([OBR.scene.grid.getDpi(), OBR.scene.grid.getScale().then((scale) => scale.parsed.multiplier)]); } catch { /* scene closed */ }
    const toWorld = (value: number) => sceneToWorldUnits(value, dpi, multiplier);
    for (const [id, state] of this.modified) {
      const committed = applyLightModifiers(state.base, state.contexts.filter(permanent), toWorld);
      try { await OBR.scene.local.updateItems<Light>([id], (items) => { for (const light of items) Object.assign(light, committed); }); } catch { /* scene closed or removed */ }
      if (state.contexts.some(permanent) && state.attachedTo) try { await persistDynamicFogLight(state.attachedTo, dynamicFogConfig(committed)); } catch { /* scene closed or target removed */ }
    }
    this.added.clear(); this.modified.clear(); this.initialized = false;
  }
}

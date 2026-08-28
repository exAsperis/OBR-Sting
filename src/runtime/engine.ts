import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import { DETECTOR_KEY } from "../constants";
import { ShaderEffectExecutor } from "../effects/shader/executor";
import { EmanationEffectExecutor } from "../effects/emanation/executor";
import { EffectExecutorRegistry } from "../effects/registry";
import { buildRuntimeEffectKey } from "../effects/runtimeKey";
import { parseDetectorMetadata } from "../metadata/parse";
import { evaluateRule, indexEmittersBySignal } from "../proximity/evaluate";
import { buildAttachmentGraph } from "../scene/attachments";
import { isAudienceMember, resolveEffectTarget } from "../scene/resolve";
import type { DebugRuleState, DesiredEffect } from "../types";

const DEBUG_STORAGE_KEY = "com.ex-asperis.proximity-signals/debug";

export class ProximityEngine {
  private latestItems: Item[] = [];
  private player: Pick<Player, "id" | "role"> | null = null;
  private party: Player[] = [];
  private running = false;
  private dirty = false;
  private registry = new EffectExecutorRegistry();

  constructor() {
    this.registry.register(new ShaderEffectExecutor());
    this.registry.register(new EmanationEffectExecutor());
  }

  setItems(items: Item[]): void { this.latestItems = items; this.schedule(); }
  setPlayer(player: Pick<Player, "id" | "role">): void { this.player = player; this.schedule(); }
  setParty(party: Player[]): void { this.party = party; this.schedule(); }

  schedule(): void {
    this.dirty = true;
    if (!this.running) void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      do {
        this.dirty = false;
        await this.reconcile();
      } while (this.dirty);
    } catch (error) {
      console.error("[Sting:error] Reconciliation failed", error);
    } finally {
      this.running = false;
      if (this.dirty) void this.run();
    }
  }

  private async reconcile(): Promise<void> {
    if (!this.player) return;
    const graph = buildAttachmentGraph(this.latestItems);
    const signalIndex = indexEmittersBySignal(this.latestItems);
    const gridScale = await OBR.scene.grid.getScale();
    const desiredByType = new Map<string, DesiredEffect[]>();
    const debug: DebugRuleState[] = [];

    for (const detector of this.latestItems) {
      const metadata = parseDetectorMetadata(detector.metadata[DETECTOR_KEY]);
      if (!metadata?.enabled) continue;
      for (const rule of metadata.rules.filter((entry) => entry.enabled)) {
        const evaluation = await evaluateRule(detector, rule, signalIndex, graph, gridScale.parsed.multiplier);
        const debugEffects: DebugRuleState["effects"] = [];
        for (const effect of rule.effects.filter((entry) => entry.enabled)) {
          const target = resolveEffectTarget(effect.target, detector, evaluation.detectedEmitter, graph);
          const audienceMatch = isAudienceMember(effect.audience, this.player, detector, target, graph);
          const runtimeKey = target ? buildRuntimeEffectKey(detector.id, rule.id, effect.id, target.id) : null;
          if (target && audienceMatch && evaluation.strength > 0 && runtimeKey) {
            const desired: DesiredEffect = { ...evaluation, effect, target, localPlayer: this.player, party: this.party, graph, runtimeKey };
            desiredByType.set(effect.type, [...(desiredByType.get(effect.type) ?? []), desired]);
          }
          debugEffects.push({
            effectId: effect.id,
            targetType: effect.target.type,
            targetName: target?.name ?? null,
            audience: effect.audience.type,
            audienceMatch,
            runtimeKey,
            localItemId: null,
          });
        }
        debug.push({
          detectorId: detector.id,
          detectorName: detector.name,
          ruleId: rule.id,
          signal: rule.signal,
          range: rule.range,
          matchingEmitterCount: evaluation.matchingEmitterCount,
          emitterName: evaluation.detectedEmitter?.name ?? null,
          distance: evaluation.distance,
          strength: evaluation.strength,
          effects: debugEffects,
        });
      }
    }

    for (const executor of this.registry.values()) {
      const localIds = await executor.reconcile(desiredByType.get(executor.type) ?? []);
      for (const rule of debug) for (const effect of rule.effects) {
        if (effect.runtimeKey) effect.localItemId = localIds.get(effect.runtimeKey) ?? null;
      }
    }
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify({ updatedAt: Date.now(), rules: debug }));
  }

  async clear(): Promise<void> {
    this.latestItems = [];
    localStorage.removeItem(DEBUG_STORAGE_KEY);
    for (const executor of this.registry.values()) await executor.clear();
  }
}

export { DEBUG_STORAGE_KEY };

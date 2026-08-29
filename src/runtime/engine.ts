import OBR, { type Item, type Player } from "@owlbear-rodeo/sdk";
import { DETECTOR_KEY } from "../constants";
import { ShaderEffectExecutor } from "../effects/shader/executor";
import { EffectExecutorRegistry, type EffectDispatchBatch } from "../effects/registry";
import { IntegrationEffectExecutor } from "../effects/integrations/executor";
import { createIntegrationProviderRegistry } from "../effects/integrations/providers";
import { buildRuntimeEffectKey } from "../effects/runtimeKey";
import { parseDetectorMetadata } from "../metadata/parse";
import { evaluateRule, indexEmittersBySignal } from "../proximity/evaluate";
import { buildAttachmentGraph } from "../scene/attachments";
import { isAudienceMember, resolveEffectTarget } from "../scene/resolve";
import { deriveTransition, toRuleSnapshot } from "./lifecycle";
import type { DebugRuleState, DesiredEffect, RuleSnapshot } from "../types";

const DEBUG_STORAGE_KEY = "com.ex-asperis.proximity-signals/debug";

export class ProximityEngine {
  private latestItems: Item[] = [];
  private player: Pick<Player, "id" | "role"> | null = null;
  private party: Player[] = [];
  private running = false;
  private dirty = false;
  private registry = new EffectExecutorRegistry();
  private ruleStates = new Map<string, RuleSnapshot>();
  private lastActiveEffects = new Map<string, DesiredEffect>();

  constructor() {
    this.registry.register(new ShaderEffectExecutor());
    this.registry.register(new IntegrationEffectExecutor(createIntegrationProviderRegistry()));
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
    const dispatchByType = new Map<string, EffectDispatchBatch>();
    const debug: DebugRuleState[] = [];
    const nextRuleKeys = new Set<string>();
    const seenEffectKeys = new Set<string>();

    const batchFor = (type: string) => {
      let batch = dispatchByType.get(type);
      if (!batch) { batch = { desired: [], events: [] }; dispatchByType.set(type, batch); }
      return batch;
    };

    for (const detector of this.latestItems) {
      const metadata = parseDetectorMetadata(detector.metadata[DETECTOR_KEY]);
      if (!metadata?.enabled) continue;
      for (const rule of metadata.rules.filter((entry) => entry.enabled)) {
        const result = await evaluateRule(detector, rule, signalIndex, graph, gridScale.parsed.multiplier);
        const baseRuleKey = `${detector.id.length}:${detector.id}|${rule.id.length}:${rule.id}`;
        const debugEffects: DebugRuleState["effects"] = [];
        for (const evaluation of result.evaluations) {
          const emitterId = evaluation.detectedEmitter?.id ?? "";
          const ruleKey = rule.aggregation === "all"
            ? `${baseRuleKey}|${emitterId.length}:${emitterId}`
            : baseRuleKey;
          nextRuleKeys.add(ruleKey);
          const previous = this.ruleStates.get(ruleKey) ?? null;
          const current = toRuleSnapshot(evaluation);
          const transition = deriveTransition(previous, current);
          this.ruleStates.set(ruleKey, current);
          for (const effect of rule.effects.filter((entry) => entry.enabled)) {
            const target = resolveEffectTarget(effect.target, detector, evaluation.detectedEmitter, graph);
            const audienceMatch = isAudienceMember(effect.audience, this.player, detector, target, graph);
            const runtimeKey = target ? buildRuntimeEffectKey(
              detector.id,
              rule.id,
              effect.id,
              target.id,
              effect.type,
              effect.type === "integration" ? effect.providerId : "",
              effect.type === "integration" ? effect.actionId : "",
              rule.aggregation === "all" ? emitterId : "",
            ) : null;
            const lifecycle = effect.type === "integration" ? effect.lifecycle : "continuous";
            // Integration authority and delivery policy are provider/action concerns.
            // Native effects retain per-client audience filtering here.
            const dispatchMatch = effect.type === "integration" || audienceMatch;
            if (target && dispatchMatch && runtimeKey) {
              const desired: DesiredEffect = { ...evaluation, effect, target, localPlayer: this.player, party: this.party, graph, runtimeKey, current, previous, transition, audienceMatch };
              seenEffectKeys.add(runtimeKey);
              if (lifecycle === "continuous" && current.active) batchFor(effect.type).desired.push(desired);
              if (lifecycle !== "continuous" && transition.type === lifecycle) batchFor(effect.type).events.push(desired);
              if (current.active) this.lastActiveEffects.set(runtimeKey, desired);
              else this.lastActiveEffects.delete(runtimeKey);
            }
            debugEffects.push({
              effectId: effect.id,
              type: effect.type,
              lifecycle,
              transition: transition.type,
              targetType: effect.target.type,
              targetName: target?.name ?? null,
              audience: effect.audience.type,
              audienceMatch,
              runtimeKey,
              localItemId: null,
              ...(effect.type === "integration" ? {
                providerId: effect.providerId,
                actionId: effect.actionId,
                providerStatus: "unchecked",
              } : {}),
            });
          }
        }
        const activeEvaluations = result.evaluations.filter((evaluation) => evaluation.strength > 0 && evaluation.detectedEmitter);
        debug.push({
          detectorId: detector.id,
          detectorName: detector.name,
          ruleId: rule.id,
          signal: rule.signal,
          aggregation: rule.aggregation,
          range: rule.range,
          matchingEmitterCount: result.matchingEmitterCount,
          activeEmitterCount: activeEvaluations.length,
          detections: activeEvaluations.map((evaluation) => ({
            emitterName: evaluation.detectedEmitter!.name || evaluation.detectedEmitter!.id,
            distance: evaluation.distance!,
            strength: evaluation.strength,
          })),
          effects: debugEffects,
        });
      }
    }

    // A deleted/disabled effect or rule has no current definition to emit an exit from.
    // Retain only its last active resolved context long enough to synthesize one exit.
    for (const [runtimeKey, previousContext] of [...this.lastActiveEffects]) {
      if (seenEffectKeys.has(runtimeKey)) continue;
      if (previousContext.effect.type === "integration" && previousContext.effect.lifecycle === "exit") {
        const current = { active: false, strength: 0, distance: previousContext.distance, detectedEmitterId: previousContext.detectedEmitter?.id ?? null };
        batchFor(previousContext.effect.type).events.push({
          ...previousContext,
          strength: 0,
          current,
          previous: previousContext.current,
          transition: { type: "exit" },
        });
      }
      this.lastActiveEffects.delete(runtimeKey);
    }

    for (const key of [...this.ruleStates.keys()]) if (!nextRuleKeys.has(key)) this.ruleStates.delete(key);

    for (const executor of this.registry.values()) {
      let report;
      try {
        report = await executor.reconcile(dispatchByType.get(executor.type) ?? { desired: [], events: [] });
      } catch (error) {
        console.error(`[Sting:${executor.type}] Reconciliation failed`, error);
        continue;
      }
      for (const rule of debug) for (const effect of rule.effects) {
        if (effect.type !== executor.type || !effect.runtimeKey) continue;
        effect.localItemId = report.localIds.get(effect.runtimeKey) ?? null;
        effect.executionStatus = report.statuses.get(effect.runtimeKey);
        if (effect.type === "integration") effect.providerStatus = effect.executionStatus === "provider-unavailable" ? "unavailable" : "configured";
      }
    }
    localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify({ updatedAt: Date.now(), rules: debug }));
  }

  async clear(): Promise<void> {
    this.latestItems = [];
    this.ruleStates.clear();
    this.lastActiveEffects.clear();
    localStorage.removeItem(DEBUG_STORAGE_KEY);
    for (const executor of this.registry.values()) await executor.clear();
  }
}

export { DEBUG_STORAGE_KEY };

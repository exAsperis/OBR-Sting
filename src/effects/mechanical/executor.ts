import OBR, { type Item } from "@owlbear-rodeo/sdk";
import type { DesiredEffect, MechanicalEffectDefinitionV1 } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";
import { advanceFaceRotation, compareFaceContexts, faceBearing, normalizeAngle, shortestAngleDelta } from "./face";

interface FaceState {
  update: (recipe: (item: Item) => void) => Item;
  stop: () => void;
  frame: number;
  currentRotation: number;
  desiredRotation: number;
  speed: number;
  lastTime: number;
  runtimeKey: string;
}

const COMPLETE_EPSILON = 0.05;

export class MechanicalEffectExecutor implements EffectExecutor<MechanicalEffectDefinitionV1> {
  readonly type = "mechanical" as const;
  readonly scope = "shared" as const;
  private states = new Map<string, FaceState>();

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const eligible = batch.desired.filter((context) =>
      context.localPlayer.role === "GM" &&
      context.effect.type === "mechanical" &&
      context.effect.action === "face" &&
      context.target !== null &&
      context.detectedEmitter !== null &&
      context.target.id !== context.detectedEmitter.id,
    );
    const winners = new Map<string, DesiredEffect>();
    for (const context of eligible) {
      const targetId = context.target!.id;
      const current = winners.get(targetId);
      if (!current || compareFaceContexts(context, current) < 0) winners.set(targetId, context);
    }

    for (const [targetId, state] of [...this.states]) {
      if (winners.has(targetId)) continue;
      this.stopState(targetId, state);
    }

    const statuses = new Map<string, string>();
    for (const [targetId, context] of winners) {
      const effect = context.effect as MechanicalEffectDefinitionV1;
      const desiredRotation = faceBearing(context.target!.position, context.detectedEmitter!.position, effect.faceAngle);
      const existing = this.states.get(targetId);
      if (existing) {
        existing.desiredRotation = desiredRotation;
        existing.speed = effect.speed;
        existing.runtimeKey = context.runtimeKey;
        statuses.set(context.runtimeKey, "tracking");
        continue;
      }
      if (Math.abs(shortestAngleDelta(context.target!.rotation, desiredRotation)) <= COMPLETE_EPSILON) {
        statuses.set(context.runtimeKey, "facing");
        continue;
      }
      try {
        const [update, stop] = await OBR.interaction.startItemInteraction(context.target!);
        const state: FaceState = {
          update: update as FaceState["update"],
          stop,
          frame: 0,
          currentRotation: normalizeAngle(context.target!.rotation),
          desiredRotation,
          speed: effect.speed,
          lastTime: performance.now(),
          runtimeKey: context.runtimeKey,
        };
        this.states.set(targetId, state);
        state.frame = requestAnimationFrame((time) => this.tick(targetId, time));
        statuses.set(context.runtimeKey, "turning");
      } catch {
        statuses.set(context.runtimeKey, "skipped");
      }
    }
    return { localIds: new Map(), statuses };
  }

  private tick(targetId: string, time: number): void {
    const state = this.states.get(targetId);
    if (!state) return;
    const elapsedSeconds = Math.max(0, time - state.lastTime) / 1000;
    state.lastTime = time;
    const delta = shortestAngleDelta(state.currentRotation, state.desiredRotation);
    state.currentRotation = advanceFaceRotation(state.currentRotation, state.desiredRotation, state.speed, elapsedSeconds);
    try {
      state.update((item) => { item.rotation = state.currentRotation; });
    } catch {
      this.stopState(targetId, state);
      return;
    }
    if (Math.abs(delta) <= COMPLETE_EPSILON || Math.abs(shortestAngleDelta(state.currentRotation, state.desiredRotation)) <= COMPLETE_EPSILON) {
      state.currentRotation = state.desiredRotation;
      try { state.update((item) => { item.rotation = state.desiredRotation; }); } catch { /* fail silently */ }
      this.stopState(targetId, state);
      return;
    }
    state.frame = requestAnimationFrame((nextTime) => this.tick(targetId, nextTime));
  }

  private stopState(targetId: string, state: FaceState): void {
    cancelAnimationFrame(state.frame);
    try { state.stop(); } catch { /* fail silently */ }
    this.states.delete(targetId);
  }

  async clear(): Promise<void> {
    for (const [targetId, state] of [...this.states]) this.stopState(targetId, state);
  }
}

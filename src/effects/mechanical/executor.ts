import OBR, { buildLine, type Item } from "@owlbear-rodeo/sdk";
import { PIVOT_DEBUG_KEY } from "../../constants";
import type { DesiredEffect, MechanicalEffectDefinitionV1, MechanicalFaceEffectDefinitionV1, MechanicalVisibilityEffectDefinitionV1 } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";
import { isMechanicalAuthority } from "./authority";
import { advanceFaceRotation, compareFaceContexts, faceBearing, localPivotFromOrigin, normalizeAngle, positionForFixedPivot, resolvePivot, shortestAngleDelta, unrotatedItemSize } from "./face";

interface FaceState {
  update: (recipe: (item: Item) => void) => Item;
  stop: () => void;
  currentRotation: number;
  localPivot: { x: number; y: number };
  currentPosition: { x: number; y: number };
  pivot: { x: number; y: number };
  pivotX: number;
  pivotY: number;
  desiredRotation: number;
  speed: number;
  lastTime: number;
  startedAt: number;
  runtimeKey: string;
  stopping: boolean;
}

interface VisibilityState {
  ownerKey: string;
  targetId: string;
  enterVisible: boolean;
  reverseOnExit: boolean;
  runtimeKey: string;
}

interface PivotMarkerState {
  ids: [string, string];
  pivot: { x: number; y: number };
  halfSize: number;
}

const COMPLETE_EPSILON = 0.05;
const MAX_INTERACTION_MS = 15_000;

export class MechanicalEffectExecutor implements EffectExecutor<MechanicalEffectDefinitionV1> {
  readonly type = "mechanical" as const;
  readonly scope = "shared" as const;
  private states = new Map<string, FaceState>();
  private visibilityStates = new Map<string, VisibilityState>();
  private pivotMarkers = new Map<string, PivotMarkerState>();
  private tickerWorker: Worker | null = null;
  private tickerTimer: ReturnType<typeof setInterval> | null = null;

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const statuses = new Map<string, string>();
    for (const context of batch.desired.filter((entry) => entry.effect.type === "mechanical")) {
      if (context.localPlayer.role !== "GM") statuses.set(context.runtimeKey, "player-inactive");
      else if (!isMechanicalAuthority(context.localPlayer, context.party)) statuses.set(context.runtimeKey, "authority-standby");
      else if (!context.target || !context.detectedEmitter) statuses.set(context.runtimeKey, "unresolved");
      else if (context.effect.type === "mechanical" && context.effect.action === "face" && context.target.id === context.detectedEmitter.id) statuses.set(context.runtimeKey, "self-skipped");
    }
    const eligible = batch.desired.filter((context) =>
      isMechanicalAuthority(context.localPlayer, context.party) &&
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
      if (!current || compareFaceContexts(context, current) < 0) {
        if (current) statuses.set(current.runtimeKey, "superseded");
        winners.set(targetId, context);
      } else {
        statuses.set(context.runtimeKey, "superseded");
      }
    }

    for (const [targetId, state] of [...this.states]) {
      if (winners.has(targetId)) continue;
      await this.commitAndStop(targetId, state);
    }
    for (const targetId of [...this.pivotMarkers.keys()]) if (!winners.has(targetId)) await this.removePivotMarker(targetId);

    for (const [targetId, context] of winners) {
      const effect = context.effect as MechanicalFaceEffectDefinitionV1;
      let existing = this.states.get(targetId);
      if (existing && (existing.pivotX !== effect.pivotX || existing.pivotY !== effect.pivotY)) {
        await this.commitAndStop(targetId, existing);
        existing = undefined;
      }
      if (existing) {
        if (!this.pivotMarkers.has(targetId)) await this.ensurePivotMarker(targetId, existing.pivot, 12);
        existing.desiredRotation = faceBearing(existing.pivot, context.detectedEmitter!.position, effect.faceAngle);
        existing.speed = effect.speed;
        existing.runtimeKey = context.runtimeKey;
        statuses.set(context.runtimeKey, "tracking");
        continue;
      }
      let bounds;
      try { bounds = await OBR.scene.items.getItemBounds([targetId]); }
      catch { statuses.set(context.runtimeKey, "skipped"); continue; }
      const size = unrotatedItemSize(context.target!, bounds);
      const pivot = resolvePivot(bounds.center, size, context.target!.rotation, effect.pivotX, effect.pivotY);
      await this.ensurePivotMarker(targetId, pivot, Math.max(8, Math.min(24, Math.min(size.width, size.height) * 0.12)));
      const desiredRotation = faceBearing(pivot, context.detectedEmitter!.position, effect.faceAngle);
      if (Math.abs(shortestAngleDelta(context.target!.rotation, desiredRotation)) <= COMPLETE_EPSILON) {
        statuses.set(context.runtimeKey, "facing");
        continue;
      }
      try {
        const [update, stop] = await OBR.interaction.startItemInteraction(context.target!);
        const state: FaceState = {
          update: update as FaceState["update"],
          stop,
          currentRotation: normalizeAngle(context.target!.rotation),
          localPivot: localPivotFromOrigin(context.target!.position, pivot, context.target!.rotation),
          currentPosition: { ...context.target!.position },
          pivot,
          pivotX: effect.pivotX,
          pivotY: effect.pivotY,
          desiredRotation,
          speed: effect.speed,
          lastTime: performance.now(),
          startedAt: performance.now(),
          runtimeKey: context.runtimeKey,
          stopping: false,
        };
        this.states.set(targetId, state);
        this.ensureTicker();
        this.tick(targetId, performance.now());
        statuses.set(context.runtimeKey, "turning");
      } catch {
        statuses.set(context.runtimeKey, "skipped");
      }
    }
    await this.reconcileVisibility(batch.desired, statuses);
    return { localIds: new Map(), statuses };
  }

  private async reconcileVisibility(desired: DesiredEffect[], statuses: Map<string, string>): Promise<void> {
    const visibilityContexts = desired.filter((context) => context.effect.type === "mechanical" && context.effect.action === "visibility");
    if (visibilityContexts.length > 0 && !visibilityContexts.some((context) => isMechanicalAuthority(context.localPlayer, context.party))) {
      this.visibilityStates.clear();
      return;
    }
    const grouped = new Map<string, DesiredEffect>();
    for (const context of visibilityContexts) {
      if (!isMechanicalAuthority(context.localPlayer, context.party) || context.effect.type !== "mechanical" || context.effect.action !== "visibility" || !context.target || !context.detectedEmitter) continue;
      const groupKey = JSON.stringify([context.detector.id, context.rule.id, context.effect.id, context.target.id]);
      const current = grouped.get(groupKey);
      if (!current || compareFaceContexts(context, current) < 0) grouped.set(groupKey, context);
    }
    const winners = new Map<string, { groupKey: string; context: DesiredEffect }>();
    for (const [groupKey, context] of grouped) {
      const targetId = context.target!.id;
      const current = winners.get(targetId);
      if (!current || compareFaceContexts(context, current.context) < 0) {
        if (current) statuses.set(current.context.runtimeKey, "superseded");
        winners.set(targetId, { groupKey, context });
      } else {
        statuses.set(context.runtimeKey, "superseded");
      }
    }

    for (const [targetId, state] of [...this.visibilityStates]) {
      const winner = winners.get(targetId);
      if (winner) continue;
      if (state.reverseOnExit) await this.setVisibility(targetId, !state.enterVisible);
      this.visibilityStates.delete(targetId);
    }
    for (const [targetId, { groupKey, context }] of winners) {
      const effect = context.effect as MechanicalVisibilityEffectDefinitionV1;
      const enterVisible = effect.visibility === "shown";
      const existing = this.visibilityStates.get(targetId);
      if (!existing || existing.ownerKey !== groupKey || existing.enterVisible !== enterVisible) {
        await this.setVisibility(targetId, enterVisible);
        this.visibilityStates.set(targetId, { ownerKey: groupKey, targetId, enterVisible, reverseOnExit: effect.reverseOnExit, runtimeKey: context.runtimeKey });
        statuses.set(context.runtimeKey, enterVisible ? "shown" : "hidden");
      } else {
        existing.reverseOnExit = effect.reverseOnExit;
        existing.runtimeKey = context.runtimeKey;
        statuses.set(context.runtimeKey, enterVisible ? "shown" : "hidden");
      }
    }
  }

  private async setVisibility(targetId: string, visible: boolean): Promise<void> {
    try {
      await OBR.scene.items.updateItems<Item>([targetId], (items) => {
        for (const item of items) item.visible = visible;
      });
    } catch { /* fail silently like other mechanical mutations */ }
  }

  private async ensurePivotMarker(targetId: string, pivot: { x: number; y: number }, halfSize: number): Promise<void> {
    const existing = this.pivotMarkers.get(targetId);
    if (existing && existing.pivot.x === pivot.x && existing.pivot.y === pivot.y && existing.halfSize === halfSize) return;
    if (existing) await this.removePivotMarker(targetId);
    try {
      const common = (axis: "horizontal" | "vertical") => buildLine()
        .name(`Sting Face pivot ${axis}`)
        .startPosition(axis === "horizontal" ? { x: pivot.x - halfSize, y: pivot.y } : { x: pivot.x, y: pivot.y - halfSize })
        .endPosition(axis === "horizontal" ? { x: pivot.x + halfSize, y: pivot.y } : { x: pivot.x, y: pivot.y + halfSize })
        .strokeColor("#ff3366")
        .strokeWidth(3)
        .locked(true)
        .disableHit(true)
        .disableAutoZIndex(true)
        .zIndex(2_000_000)
        .layer("POINTER")
        .metadata({ [PIVOT_DEBUG_KEY]: { targetId, source: "runtime" } })
        .build();
      const lines = [common("horizontal"), common("vertical")];
      await OBR.scene.local.addItems(lines);
      this.pivotMarkers.set(targetId, { ids: [lines[0].id, lines[1].id], pivot: { ...pivot }, halfSize });
    } catch { /* debugging feedback must not interrupt the effect */ }
  }

  private async removePivotMarker(targetId: string): Promise<void> {
    const marker = this.pivotMarkers.get(targetId);
    if (!marker) return;
    try { await OBR.scene.local.deleteItems(marker.ids); } catch { /* fail silently */ }
    this.pivotMarkers.delete(targetId);
  }

  private tick(targetId: string, time: number): void {
    const state = this.states.get(targetId);
    if (!state) return;
    if (time - state.startedAt >= MAX_INTERACTION_MS) {
      void this.commitAndStop(targetId, state);
      return;
    }
    const elapsedSeconds = Math.max(0, time - state.lastTime) / 1000;
    state.lastTime = time;
    const delta = shortestAngleDelta(state.currentRotation, state.desiredRotation);
    state.currentRotation = advanceFaceRotation(state.currentRotation, state.desiredRotation, state.speed, elapsedSeconds);
    state.currentPosition = positionForFixedPivot(state.pivot, state.localPivot, state.currentRotation);
    try {
      state.update((item) => { item.rotation = state.currentRotation; item.position = state.currentPosition; });
    } catch {
      void this.commitAndStop(targetId, state);
      return;
    }
    if (Math.abs(delta) <= COMPLETE_EPSILON || Math.abs(shortestAngleDelta(state.currentRotation, state.desiredRotation)) <= COMPLETE_EPSILON) {
      state.currentRotation = state.desiredRotation;
      state.currentPosition = positionForFixedPivot(state.pivot, state.localPivot, state.desiredRotation);
      try { state.update((item) => { item.rotation = state.desiredRotation; item.position = state.currentPosition; }); } catch { /* fail silently */ }
      void this.commitAndStop(targetId, state);
      return;
    }
  }

  private async commitAndStop(targetId: string, state: FaceState): Promise<void> {
    if (state.stopping) return;
    state.stopping = true;
    try {
      await OBR.scene.items.updateItems<Item>([targetId], (items) => {
        for (const item of items) { item.rotation = state.currentRotation; item.position = state.currentPosition; }
      });
    } catch { /* preserve best-effort silent failure behavior */ }
    try { state.stop(); } catch { /* fail silently */ }
    if (this.states.get(targetId) === state) this.states.delete(targetId);
    if (this.states.size === 0) this.stopTicker();
  }

  private ensureTicker(): void {
    if (this.tickerWorker || this.tickerTimer !== null) return;
    if (typeof Worker !== "undefined" && typeof Blob !== "undefined") {
      try {
        const url = URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 50);"], { type: "text/javascript" }));
        this.tickerWorker = new Worker(url);
        URL.revokeObjectURL(url);
        this.tickerWorker.onmessage = () => this.tickAll();
        return;
      } catch { /* use the timer fallback below */ }
    }
    this.tickerTimer = setInterval(() => this.tickAll(), 50);
  }

  private tickAll(): void {
    const time = performance.now();
    for (const targetId of [...this.states.keys()]) this.tick(targetId, time);
  }

  private stopTicker(): void {
    this.tickerWorker?.terminate();
    this.tickerWorker = null;
    if (this.tickerTimer !== null) clearInterval(this.tickerTimer);
    this.tickerTimer = null;
  }

  async clear(): Promise<void> {
    for (const [targetId, state] of [...this.states]) await this.commitAndStop(targetId, state);
    this.visibilityStates.clear();
    for (const targetId of [...this.pivotMarkers.keys()]) await this.removePivotMarker(targetId);
    this.stopTicker();
  }
}

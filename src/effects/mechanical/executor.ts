import OBR, { buildLine, isImage, type Image, type Item } from "@owlbear-rodeo/sdk";
import { EMITTER_KEY, PIVOT_DEBUG_KEY } from "../../constants";
import { parseEmitterMetadata } from "../../metadata/parse";
import { normalizeSignals } from "../../signals/normalize";
import type { DesiredEffect, MechanicalEffectDefinitionV1, MechanicalFaceEffectDefinitionV1, MechanicalVisibilityEffectDefinitionV1 } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";
import type { SharedEffectAuthority } from "./authority";
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
  baseVisible: boolean;
  appliedVisible: boolean;
  reverseOnExit: boolean;
  runtimeKey: string;
}

interface BooleanState { ownerKey: string; base: boolean; applied: boolean; reverseOnExit: boolean; runtimeKey: string }
interface ImageState { ownerKey: string; base: Pick<Image, "image" | "grid" | "scale">; applied: Pick<Image, "image" | "grid" | "scale">; reverseOnExit: boolean; runtimeKey: string }
interface EmitterState { base: unknown; applied: unknown; contexts: DesiredEffect[] }
interface FaceRestoreState { position: { x: number; y: number }; rotation: number; reverseOnExit: boolean }

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
  private faceRestoreStates = new Map<string, FaceRestoreState>();
  private visibilityStates = new Map<string, VisibilityState>();
  private lockStates = new Map<string, BooleanState>();
  private imageStates = new Map<string, ImageState>();
  private emitterStates = new Map<string, EmitterState>();
  private pivotMarkers = new Map<string, PivotMarkerState>();
  private tickerWorker: Worker | null = null;
  private tickerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly authority: SharedEffectAuthority) {}

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const statuses = new Map<string, string>();
    for (const context of batch.desired.filter((entry) => entry.effect.type === "mechanical")) {
      if (context.localPlayer.role !== "GM") statuses.set(context.runtimeKey, "player-inactive");
      else if (!this.authority.isAuthority()) statuses.set(context.runtimeKey, this.authority.getSnapshot().state === "discovering" ? "authority-discovering" : "authority-standby");
      else if (!context.target || !context.detectedEmitter) statuses.set(context.runtimeKey, "unresolved");
      else if (context.effect.type === "mechanical" && context.effect.action === "face" && context.target.id === context.detectedEmitter.id) statuses.set(context.runtimeKey, "self-skipped");
    }
    const eligible = batch.desired.filter((context) =>
      context.localPlayer.role === "GM" && this.authority.isAuthority() &&
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
    for (const [targetId, state] of [...this.faceRestoreStates]) {
      if (winners.has(targetId)) continue;
      if (state.reverseOnExit) await this.restoreFacing(targetId, state);
      this.faceRestoreStates.delete(targetId);
    }
    for (const targetId of [...this.pivotMarkers.keys()]) if (!winners.has(targetId)) await this.removePivotMarker(targetId);

    for (const [targetId, context] of winners) {
      const effect = context.effect as MechanicalFaceEffectDefinitionV1;
      const restore = this.faceRestoreStates.get(targetId) ?? { position: { ...context.target!.position }, rotation: context.target!.rotation, reverseOnExit: effect.reverseOnExit };
      restore.reverseOnExit = effect.reverseOnExit;
      this.faceRestoreStates.set(targetId, restore);
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
    await this.reconcileLock(batch.desired, statuses);
    await this.reconcileImages(batch.desired, statuses);
    await this.reconcileEmitters(batch.desired, statuses);
    return { localIds: new Map(), statuses };
  }

  private async reconcileVisibility(desired: DesiredEffect[], statuses: Map<string, string>): Promise<void> {
    const visibilityContexts = desired.filter((context) => context.effect.type === "mechanical" && context.effect.action === "visibility");
    if (visibilityContexts.length > 0 && !this.authority.isAuthority()) {
      this.visibilityStates.clear();
      return;
    }
    const grouped = new Map<string, DesiredEffect>();
    for (const context of visibilityContexts) {
      if (context.localPlayer.role !== "GM" || !this.authority.isAuthority() || context.effect.type !== "mechanical" || context.effect.action !== "visibility" || !context.target || !context.detectedEmitter) continue;
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
      if (state.reverseOnExit) await this.setVisibility(targetId, state.baseVisible);
      this.visibilityStates.delete(targetId);
    }
    for (const [targetId, { groupKey, context }] of winners) {
      const effect = context.effect as MechanicalVisibilityEffectDefinitionV1;
      let state = this.visibilityStates.get(targetId);
      if (!state) state = { ownerKey: groupKey, targetId, baseVisible: context.target!.visible, appliedVisible: context.target!.visible, reverseOnExit: effect.reverseOnExit, runtimeKey: context.runtimeKey };
      const enterVisible = effect.visibility === "toggle" ? !state.baseVisible : effect.visibility === "shown";
      if (state.appliedVisible !== enterVisible) await this.setVisibility(targetId, enterVisible);
      Object.assign(state, { ownerKey: groupKey, appliedVisible: enterVisible, reverseOnExit: effect.reverseOnExit, runtimeKey: context.runtimeKey });
      this.visibilityStates.set(targetId, state);
      statuses.set(context.runtimeKey, enterVisible ? "shown" : "hidden");
    }
  }

  private async restoreFacing(targetId: string, state: FaceRestoreState): Promise<void> {
    try { await OBR.scene.items.updateItems<Item>([targetId], (items) => { for (const item of items) { item.position = { ...state.position }; item.rotation = state.rotation; } }); } catch { /* best effort */ }
  }

  private async setVisibility(targetId: string, visible: boolean): Promise<void> {
    try {
      await OBR.scene.items.updateItems<Item>([targetId], (items) => {
        for (const item of items) item.visible = visible;
      });
    } catch { /* fail silently like other mechanical mutations */ }
  }

  private mutationWinners(desired: DesiredEffect[], action: "lock" | "set-image", statuses: Map<string, string>): Map<string, { ownerKey: string; context: DesiredEffect }> {
    const winners = new Map<string, { ownerKey: string; context: DesiredEffect }>();
    for (const context of desired) {
      if (context.localPlayer.role !== "GM" || !this.authority.isAuthority() || context.effect.type !== "mechanical" || context.effect.action !== action || !context.target) continue;
      const ownerKey = JSON.stringify([context.detector.id, context.rule.id, context.effect.id, context.target.id]);
      const current = winners.get(context.target.id);
      if (!current || compareFaceContexts(context, current.context) < 0) {
        if (current) statuses.set(current.context.runtimeKey, "superseded");
        winners.set(context.target.id, { ownerKey, context });
      } else statuses.set(context.runtimeKey, "superseded");
    }
    return winners;
  }

  private async reconcileLock(desired: DesiredEffect[], statuses: Map<string, string>): Promise<void> {
    const contexts = desired.filter((context) => context.effect.type === "mechanical" && context.effect.action === "lock");
    if (contexts.length && !this.authority.isAuthority()) { this.lockStates.clear(); return; }
    const winners = this.mutationWinners(desired, "lock", statuses);
    for (const [targetId, state] of [...this.lockStates]) {
      if (winners.has(targetId)) continue;
      if (state.reverseOnExit) await this.setLocked(targetId, state.base);
      this.lockStates.delete(targetId);
    }
    for (const [targetId, { ownerKey, context }] of winners) {
      const effect = context.effect as Extract<MechanicalEffectDefinitionV1, { action: "lock" }>;
      let state = this.lockStates.get(targetId);
      if (!state) state = { ownerKey, base: context.target!.locked, applied: context.target!.locked, reverseOnExit: effect.reverseOnExit, runtimeKey: context.runtimeKey };
      const applied = effect.toggle ? !state.base : effect.locked;
      if (state.applied !== applied) await this.setLocked(targetId, applied);
      Object.assign(state, { ownerKey, applied, reverseOnExit: effect.reverseOnExit, runtimeKey: context.runtimeKey });
      this.lockStates.set(targetId, state);
      statuses.set(context.runtimeKey, applied ? "locked" : "unlocked");
    }
  }

  private async setLocked(targetId: string, locked: boolean): Promise<void> {
    try { await OBR.scene.items.updateItems<Item>([targetId], (items) => { for (const item of items) item.locked = locked; }); } catch { /* best effort */ }
  }

  private async reconcileImages(desired: DesiredEffect[], statuses: Map<string, string>): Promise<void> {
    const contexts = desired.filter((context) => context.effect.type === "mechanical" && context.effect.action === "set-image");
    if (contexts.length && !this.authority.isAuthority()) { this.imageStates.clear(); return; }
    const eligible = contexts.filter((context) => {
      const effect = context.effect as Extract<MechanicalEffectDefinitionV1, { action: "set-image" }>;
      if (!effect.asset) { statuses.set(context.runtimeKey, "image-not-selected"); return false; }
      if (!context.target || !isImage(context.target)) { statuses.set(context.runtimeKey, "target-not-image"); return false; }
      return true;
    });
    const winners = this.mutationWinners(eligible, "set-image", statuses);
    for (const [targetId, state] of [...this.imageStates]) {
      if (winners.has(targetId)) continue;
      if (state.reverseOnExit) await this.setImage(targetId, state.base);
      this.imageStates.delete(targetId);
    }
    for (const [targetId, { ownerKey, context }] of winners) {
      const effect = context.effect as Extract<MechanicalEffectDefinitionV1, { action: "set-image" }>;
      const target = context.target as Image;
      let state = this.imageStates.get(targetId);
      if (!state) {
        const base = structuredClone({ image: target.image, grid: target.grid, scale: target.scale });
        state = { ownerKey, base, applied: base, reverseOnExit: effect.reverseOnExit, runtimeKey: context.runtimeKey };
      }
      const asset = effect.asset!;
      const scale = effect.constrainToOriginalSize ? {
        x: state.base.scale.x * (state.base.image.width / state.base.grid.dpi) / (asset.image.width / asset.grid.dpi),
        y: state.base.scale.y * (state.base.image.height / state.base.grid.dpi) / (asset.image.height / asset.grid.dpi),
      } : state.base.scale;
      const applied = structuredClone({ image: asset.image, grid: asset.grid, scale });
      if (JSON.stringify(state.applied) !== JSON.stringify(applied)) await this.setImage(targetId, applied);
      Object.assign(state, { ownerKey, applied, reverseOnExit: effect.reverseOnExit, runtimeKey: context.runtimeKey });
      this.imageStates.set(targetId, state);
      statuses.set(context.runtimeKey, "image-set");
    }
  }

  private async setImage(targetId: string, state: Pick<Image, "image" | "grid" | "scale">): Promise<void> {
    try { await OBR.scene.items.updateItems<Image>([targetId], (items) => { for (const item of items) if (isImage(item)) { item.image = structuredClone(state.image); item.grid = structuredClone(state.grid); item.scale = { ...state.scale }; } }); } catch { /* best effort */ }
  }

  private async reconcileEmitters(desired: DesiredEffect[], statuses: Map<string, string>): Promise<void> {
    const contexts = desired.filter((context) => context.effect.type === "mechanical" && context.effect.action === "emitter" && context.target);
    if (contexts.length && !this.authority.isAuthority()) { this.emitterStates.clear(); return; }
    const grouped = new Map<string, DesiredEffect[]>();
    for (const context of contexts) {
      if (context.localPlayer.role !== "GM" || !this.authority.isAuthority() || !context.target) continue;
      const normalized = normalizeSignals([(context.effect as Extract<MechanicalEffectDefinitionV1, { action: "emitter" }>).signal])[0];
      if (!normalized) { statuses.set(context.runtimeKey, "invalid-emitter"); continue; }
      grouped.set(context.target.id, [...(grouped.get(context.target.id) ?? []), context]);
    }
    for (const [targetId, state] of [...this.emitterStates]) {
      if (grouped.has(targetId)) continue;
      const retained = this.applyEmitterContexts(state.base, state.contexts.filter((context) => !(context.effect as Extract<MechanicalEffectDefinitionV1, { action: "emitter" }>).reverseOnExit));
      await this.setEmitterMetadata(targetId, retained);
      this.emitterStates.delete(targetId);
    }
    for (const [targetId, nextContexts] of grouped) {
      let state = this.emitterStates.get(targetId);
      if (!state) state = { base: structuredClone(nextContexts[0].target!.metadata[EMITTER_KEY]), applied: undefined, contexts: [] };
      const activeOwnerKeys = new Set(nextContexts.map((context) => this.emitterOwnerKey(context)));
      state.base = this.applyEmitterContexts(state.base, state.contexts.filter((context) => !activeOwnerKeys.has(this.emitterOwnerKey(context)) && !(context.effect as Extract<MechanicalEffectDefinitionV1, { action: "emitter" }>).reverseOnExit));
      const applied = this.applyEmitterContexts(state.base, nextContexts);
      if (JSON.stringify(applied) !== JSON.stringify(state.applied)) await this.setEmitterMetadata(targetId, applied);
      state.applied = applied; state.contexts = nextContexts; this.emitterStates.set(targetId, state);
      for (const context of nextContexts) { const operation = (context.effect as Extract<MechanicalEffectDefinitionV1, { action: "emitter" }>).operation; statuses.set(context.runtimeKey, operation === "add" ? "emitter-added" : operation === "remove" ? "emitter-removed" : "emitter-toggled"); }
    }
  }

  private emitterOwnerKey(context: DesiredEffect): string {
    return JSON.stringify([context.detector.id, context.rule.id, context.effect.id, context.target?.id]);
  }

  private applyEmitterContexts(base: unknown, contexts: DesiredEffect[]): unknown {
    if (contexts.length === 0) return structuredClone(base);
    const parsed = parseEmitterMetadata(base) ?? { version: 1 as const, enabled: true, signals: [] };
    let signals = [...parsed.signals];
    const seen = new Set<string>();
    for (const context of [...contexts].sort((a, b) => a.runtimeKey.localeCompare(b.runtimeKey))) {
      const ownerKey = this.emitterOwnerKey(context);
      if (seen.has(ownerKey)) continue;
      seen.add(ownerKey);
      const effect = context.effect as Extract<MechanicalEffectDefinitionV1, { action: "emitter" }>;
      const signal = normalizeSignals([effect.signal])[0];
      if (!signal) continue;
      signals = effect.operation === "add" || effect.operation === "toggle" && !signals.includes(signal) ? normalizeSignals([...signals, signal]) : signals.filter((entry) => entry !== signal);
    }
    return { version: 1, enabled: parsed.enabled, signals };
  }

  private async setEmitterMetadata(targetId: string, metadata: unknown): Promise<void> {
    try { await OBR.scene.items.updateItems<Item>([targetId], (items) => { for (const item of items) { if (metadata === undefined) delete item.metadata[EMITTER_KEY]; else item.metadata[EMITTER_KEY] = structuredClone(metadata); } }); } catch { /* best effort */ }
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
    this.faceRestoreStates.clear();
    this.lockStates.clear();
    this.imageStates.clear();
    this.emitterStates.clear();
    for (const targetId of [...this.pivotMarkers.keys()]) await this.removePivotMarker(targetId);
    this.stopTicker();
  }
}

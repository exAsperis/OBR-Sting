import type { DesiredEffect, EffectDefinitionV1 } from "../types";

export interface EffectDispatchBatch {
  desired: DesiredEffect[];
  events: DesiredEffect[];
}

export interface EffectReconcileReport {
  localIds: Map<string, string>;
  statuses: Map<string, string>;
}

export interface EffectExecutor<T extends EffectDefinitionV1 = EffectDefinitionV1> {
  type: T["type"];
  scope: "local" | "shared";
  reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport>;
  clear(): Promise<void>;
}

export class EffectExecutorRegistry {
  private executors = new Map<string, EffectExecutor>();
  register(executor: EffectExecutor): void { this.executors.set(executor.type, executor); }
  get(type: string): EffectExecutor | undefined { return this.executors.get(type); }
  values(): EffectExecutor[] { return [...this.executors.values()]; }
}

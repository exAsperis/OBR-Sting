import type { DesiredEffect, EffectDefinitionV1 } from "../types";

export interface EffectExecutor<T extends EffectDefinitionV1 = EffectDefinitionV1> {
  type: T["type"];
  scope: "local" | "shared";
  reconcile(desired: DesiredEffect[]): Promise<Map<string, string>>;
  clear(): Promise<void>;
}

export class EffectExecutorRegistry {
  private executors = new Map<string, EffectExecutor>();
  register(executor: EffectExecutor): void { this.executors.set(executor.type, executor); }
  get(type: string): EffectExecutor | undefined { return this.executors.get(type); }
  values(): EffectExecutor[] { return [...this.executors.values()]; }
}

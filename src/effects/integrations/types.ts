import type { DesiredEffect, EffectLifecycle, IntegrationEffectDefinitionV1, JsonObject } from "../../types";

export type ProviderAvailability =
  | { status: "available"; checkedAt: number }
  | { status: "unavailable"; reason?: string; checkedAt: number }
  | { status: "incompatible"; reason: string; checkedAt: number }
  | { status: "unknown"; reason?: string; checkedAt: number };

export interface IntegrationActionDefinition {
  id: string;
  displayName: string;
  allowedLifecycles: readonly EffectLifecycle[];
  stateful: boolean;
  execution: "local-each-client" | "single-authority";
  audienceMode: "local-filter" | "provider-recipients" | "public-only";
  validateParameters(parameters: JsonObject): string[];
}

export interface ProviderBatch {
  desired: DesiredEffect[];
  events: DesiredEffect[];
}

export interface ProviderResult {
  handles: Map<string, string>;
  statuses: Map<string, string>;
}

export interface IntegrationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly schemaVersion: number;
  readonly actions: readonly IntegrationActionDefinition[];
  getAvailability(): Promise<ProviderAvailability>;
  validate(effect: IntegrationEffectDefinitionV1): string[];
  reconcile(batch: ProviderBatch): Promise<ProviderResult>;
  clear(): Promise<void>;
}

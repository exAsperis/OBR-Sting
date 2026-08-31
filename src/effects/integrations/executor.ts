import type { DesiredEffect, IntegrationEffectDefinitionV1 } from "../../types";
import type { EffectDispatchBatch, EffectExecutor, EffectReconcileReport } from "../registry";
import type { IntegrationProviderRegistry } from "./registry";
import type { SharedEffectAuthority } from "../mechanical/authority";

export class IntegrationEffectExecutor implements EffectExecutor<IntegrationEffectDefinitionV1> {
  readonly type = "integration" as const;
  readonly scope = "shared" as const;

  constructor(private readonly providers: IntegrationProviderRegistry, private readonly authority: SharedEffectAuthority) {}

  async reconcile(batch: EffectDispatchBatch): Promise<EffectReconcileReport> {
    const localIds = new Map<string, string>();
    const statuses = new Map<string, string>();
    const providerIds = new Set([
      ...this.providers.list().map((provider) => provider.id),
      ...[...batch.desired, ...batch.events].map((entry) => (entry.effect as IntegrationEffectDefinitionV1).providerId),
    ]);

    for (const providerId of providerIds) {
      const provider = this.providers.get(providerId);
      const desired = batch.desired.filter((entry) => (entry.effect as IntegrationEffectDefinitionV1).providerId === providerId);
      const events = batch.events.filter((entry) => (entry.effect as IntegrationEffectDefinitionV1).providerId === providerId);
      if (!provider) {
        for (const entry of [...desired, ...events]) statuses.set(entry.runtimeKey, "provider-unavailable");
        continue;
      }
      const valid = (entry: DesiredEffect) => {
        const effect = entry.effect as IntegrationEffectDefinitionV1;
        const action = provider.actions.find((candidate) => candidate.id === effect.actionId);
        const authorized = action?.execution === "single-authority"
          ? entry.localPlayer.role === "GM" && this.authority.isAuthority()
          : entry.audienceMatch;
        if (!authorized) {
          statuses.set(entry.runtimeKey, "not-execution-client");
          return false;
        }
        const errors = provider.validate(effect);
        if (errors.length) statuses.set(entry.runtimeKey, `invalid: ${errors.join(" ")}`);
        return errors.length === 0;
      };
      try {
        const result = await provider.reconcile({ desired: desired.filter(valid), events: events.filter(valid) });
        for (const [key, value] of result.handles) localIds.set(key, value);
        for (const [key, value] of result.statuses) statuses.set(key, value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const entry of [...desired, ...events]) statuses.set(entry.runtimeKey, `provider-error: ${message}`);
      }
    }
    return { localIds, statuses };
  }

  async clear(): Promise<void> {
    for (const provider of this.providers.list()) {
      try { await provider.clear(); } catch (error) { console.error(`[Sting:${provider.id}] Clear failed`, error); }
    }
  }
}

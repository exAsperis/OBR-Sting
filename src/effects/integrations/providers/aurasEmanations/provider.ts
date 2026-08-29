import OBR from "@owlbear-rodeo/sdk";
import { EMANATION_INTEGRATION_KEY } from "../../../../constants";
import type { IntegrationEffectDefinitionV1, JsonObject } from "../../../../types";
import type { IntegrationProvider, ProviderBatch, ProviderResult } from "../../types";

const CHANNEL = "com.desain.emanation/message";

interface RuntimeState {
  targetId: string;
  presetName: string;
  cleanup: "leave" | "remove-all-with-warning";
}

function readParameters(parameters: JsonObject): { presetName: string; cleanup: RuntimeState["cleanup"] } | null {
  if (typeof parameters.presetName !== "string" || parameters.presetName.trim().length === 0) return null;
  if (parameters.cleanup !== "leave" && parameters.cleanup !== "remove-all-with-warning") return null;
  return { presetName: parameters.presetName.trim(), cleanup: parameters.cleanup };
}

async function createAura(targetId: string, presetName: string): Promise<void> {
  await OBR.broadcast.sendMessage(CHANNEL, { type: "CREATE_AURAS_PRESETS", sources: [targetId], presets: [presetName] }, { destination: "LOCAL" });
}

async function removeAuras(targetId: string): Promise<void> {
  await OBR.broadcast.sendMessage(CHANNEL, { type: "REMOVE_AURAS", sources: [targetId] }, { destination: "LOCAL" });
}

export class AurasEmanationsProvider implements IntegrationProvider {
  readonly id = "auras-emanations";
  readonly displayName = "Auras & Emanations";
  readonly schemaVersion = 1;
  readonly actions = [{
    id: "preset-aura",
    displayName: "Preset Aura",
    allowedLifecycles: ["continuous"] as const,
    stateful: true,
    execution: "single-authority" as const,
    audienceMode: "public-only" as const,
    validateParameters: (parameters: JsonObject) => readParameters(parameters) ? [] : ["Preset name and cleanup policy are invalid."],
  }];
  private readonly states = new Map<string, RuntimeState>();

  async getAvailability() {
    const enabled = localStorage.getItem(EMANATION_INTEGRATION_KEY) === "true";
    return enabled
      ? { status: "unknown" as const, reason: "The public A&E API has no readiness handshake.", checkedAt: Date.now() }
      : { status: "unavailable" as const, reason: "Integration is disabled in Sting.", checkedAt: Date.now() };
  }

  validate(effect: IntegrationEffectDefinitionV1): string[] {
    if (effect.providerSchemaVersion !== this.schemaVersion) return ["Unsupported provider schema version."];
    const action = this.actions.find((entry) => entry.id === effect.actionId);
    if (!action) return ["Unknown action."];
    if (!(action.allowedLifecycles as readonly string[]).includes(effect.lifecycle)) return ["Unsupported lifecycle."];
    if (effect.audience.type !== "everyone") return ["A&E preset auras currently support the Everyone audience only."];
    return action.validateParameters(effect.parameters);
  }

  async reconcile(batch: ProviderBatch): Promise<ProviderResult> {
    const availability = await this.getAvailability();
    const applicable = availability.status === "unavailable" ? [] : batch.desired;
    const active = new Set(applicable.map((entry) => entry.runtimeKey));
    const statuses = new Map<string, string>();
    if (availability.status === "unavailable") {
      for (const entry of [...batch.desired, ...batch.events]) statuses.set(entry.runtimeKey, "provider-unavailable");
    }

    for (const [key, state] of [...this.states]) {
      if (active.has(key)) continue;
      try {
        if (state.cleanup === "remove-all-with-warning") await removeAuras(state.targetId);
        this.states.delete(key);
      } catch (error) {
        statuses.set(key, `deactivate-error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const context of applicable) {
      const effect = context.effect as IntegrationEffectDefinitionV1;
      const parameters = readParameters(effect.parameters);
      if (!context.target || !parameters) { statuses.set(context.runtimeKey, "invalid"); continue; }
      const existing = this.states.get(context.runtimeKey);
      if (existing && existing.targetId === context.target.id && existing.presetName === parameters.presetName) {
        existing.cleanup = parameters.cleanup;
        statuses.set(context.runtimeKey, "active");
        continue;
      }
      try {
        if (existing?.cleanup === "remove-all-with-warning") await removeAuras(existing.targetId);
        await createAura(context.target.id, parameters.presetName);
        this.states.set(context.runtimeKey, { targetId: context.target.id, ...parameters });
        statuses.set(context.runtimeKey, "active");
      } catch (error) {
        statuses.set(context.runtimeKey, `error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      handles: new Map([...this.states].map(([key]) => [key, `auras-emanations:${key}`])),
      statuses,
    };
  }

  async clear(): Promise<void> {
    for (const state of this.states.values()) if (state.cleanup === "remove-all-with-warning") await removeAuras(state.targetId);
    this.states.clear();
  }
}

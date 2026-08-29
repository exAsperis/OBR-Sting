import type { EffectAudienceV1, EffectLifecycle, IntegrationEffectDefinitionV1, JsonObject } from "../../types";

export type ParameterField =
  | { type: "text"; key: string; label: string }
  | { type: "number"; key: string; label: string; min?: number; max?: number; step?: number }
  | { type: "boolean"; key: string; label: string }
  | { type: "select"; key: string; label: string; options: readonly { value: string; label: string }[]; warning?: string };

export interface IntegrationActionCatalogEntry {
  id: string;
  displayName: string;
  allowedLifecycles: readonly EffectLifecycle[];
  allowedAudiences: readonly EffectAudienceV1["type"][];
  parameters: readonly ParameterField[];
  defaults: JsonObject;
}

export interface IntegrationProviderCatalogEntry {
  id: string;
  displayName: string;
  iconUrl: string;
  schemaVersion: number;
  actions: readonly IntegrationActionCatalogEntry[];
}

export const INTEGRATION_CATALOG: readonly IntegrationProviderCatalogEntry[] = [{
  id: "auras-emanations",
  displayName: "Auras & Emanations",
  iconUrl: "./icon-reticle.svg",
  schemaVersion: 1,
  actions: [{
    id: "preset-aura",
    displayName: "Preset Aura",
    allowedLifecycles: ["continuous"],
    allowedAudiences: ["everyone"],
    defaults: { presetName: "Default", cleanup: "leave" },
    parameters: [
      { type: "text", key: "presetName", label: "Preset or group name" },
      {
        type: "select", key: "cleanup", label: "When inactive",
        options: [
          { value: "leave", label: "Leave created auras" },
          { value: "remove-all-with-warning", label: "Remove every aura from target" },
        ],
        warning: "A&E can only remove every aura from the target, including auras not created by Sting.",
      },
    ],
  }],
}];

function defaultAudience(type: EffectAudienceV1["type"]): EffectAudienceV1 {
  return type === "specific-users" ? { type, userIds: [] } : { type };
}

export function createIntegrationEffect(providerId = "auras-emanations", actionId = "preset-aura"): IntegrationEffectDefinitionV1 {
  const provider = INTEGRATION_CATALOG.find((entry) => entry.id === providerId);
  const action = provider?.actions.find((entry) => entry.id === actionId);
  if (!provider || !action) throw new Error(`Unknown compiled integration: ${providerId}/${actionId}`);
  return {
    id: crypto.randomUUID(), type: "integration", enabled: true,
    lifecycle: action.allowedLifecycles[0], target: { type: "detector" }, audience: defaultAudience(action.allowedAudiences[0]),
    providerId, providerSchemaVersion: provider.schemaVersion, actionId, parameters: { ...action.defaults },
  };
}

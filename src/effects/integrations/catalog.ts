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
  warning?: string;
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
  iconUrl: "https://owlbear-emanation.pages.dev/logo.png",
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
}, {
  id: "rumble",
  displayName: "Rumble!",
  iconUrl: "https://battle-system.com/owlbear/rumble-docs/logo.png",
  schemaVersion: 1,
  actions: [{
    id: "send-message",
    displayName: "Send Message",
    allowedLifecycles: ["enter", "exit", "nearest-change"],
    allowedAudiences: ["everyone", "gm", "players", "detector-owner", "carrier-owner", "target-owner", "specific-users"],
    defaults: { message: "A signal was detected." },
    parameters: [{ type: "text", key: "message", label: "Message" }],
    warning: "Message text is stored in shared detector metadata. Direct delivery does not make the configured text secret.",
  }, {
    id: "roll-dice",
    displayName: "Roll Dice",
    allowedLifecycles: ["enter", "exit", "nearest-change"],
    allowedAudiences: ["everyone"],
    defaults: { notation: "1d20" },
    parameters: [{ type: "text", key: "notation", label: "Dice notation" }],
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

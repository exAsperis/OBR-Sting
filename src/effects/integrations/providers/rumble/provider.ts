import OBR from "@owlbear-rodeo/sdk";
import { EXTENSION_NAME, RUMBLE_INTEGRATION_KEY } from "../../../../constants";
import { resolveAudienceUserIds } from "../../../../scene/resolve";
import type { IntegrationEffectDefinitionV1, JsonObject } from "../../../../types";
import type { IntegrationProvider, ProviderBatch, ProviderResult } from "../../types";

export const RUMBLE_CHAT_KEY = "com.battle-system.friends/metadata_chatlog";
export const RUMBLE_DICE_KEY = "com.battle-system.friends/metadata_diceroll";

function textParameter(parameters: JsonObject, key: string): string | null {
  const value = parameters[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RumbleProvider implements IntegrationProvider {
  readonly id = "rumble";
  readonly displayName = "Rumble!";
  readonly schemaVersion = 1;
  readonly actions = [{
    id: "send-message",
    displayName: "Send Message",
    allowedLifecycles: ["enter", "exit", "nearest-change"] as const,
    stateful: false,
    execution: "single-authority" as const,
    audienceMode: "provider-recipients" as const,
    validateParameters: (parameters: JsonObject) => textParameter(parameters, "message") ? [] : ["Message must not be empty."],
  }, {
    id: "roll-dice",
    displayName: "Roll Dice",
    allowedLifecycles: ["enter", "exit", "nearest-change"] as const,
    stateful: false,
    execution: "single-authority" as const,
    audienceMode: "public-only" as const,
    validateParameters: (parameters: JsonObject) => textParameter(parameters, "notation") ? [] : ["Dice notation must not be empty."],
  }];

  async getAvailability() {
    const metadata = await OBR.scene.getMetadata();
    return metadata[RUMBLE_INTEGRATION_KEY] === true
      ? { status: "unknown" as const, reason: "Rumble! has no readiness handshake.", checkedAt: Date.now() }
      : { status: "unavailable" as const, reason: "Integration is disabled in Sting.", checkedAt: Date.now() };
  }

  validate(effect: IntegrationEffectDefinitionV1): string[] {
    if (effect.providerSchemaVersion !== this.schemaVersion) return ["Unsupported provider schema version."];
    const action = this.actions.find((entry) => entry.id === effect.actionId);
    if (!action) return ["Unknown action."];
    if (!(action.allowedLifecycles as readonly string[]).includes(effect.lifecycle)) return ["Unsupported lifecycle."];
    if (effect.actionId === "roll-dice" && effect.audience.type !== "everyone") return ["Rumble! dice rolls support the Everyone audience only."];
    return action.validateParameters(effect.parameters);
  }

  async reconcile(batch: ProviderBatch): Promise<ProviderResult> {
    const statuses = new Map<string, string>();
    const availability = await this.getAvailability();
    if (availability.status === "unavailable") {
      for (const entry of [...batch.desired, ...batch.events]) statuses.set(entry.runtimeKey, "provider-unavailable");
      return { handles: new Map(), statuses };
    }

    for (const context of batch.events) {
      const effect = context.effect as IntegrationEffectDefinitionV1;
      if (effect.actionId === "send-message") {
        const message = textParameter(effect.parameters, "message");
        if (!message) { statuses.set(context.runtimeKey, "invalid"); continue; }
        const recipients = effect.audience.type === "everyone"
          ? ["0000"]
          : resolveAudienceUserIds(effect.audience, [context.localPlayer, ...context.party], context.detector, context.target, context.graph);
        if (!recipients.length) { statuses.set(context.runtimeKey, "no-recipients"); continue; }
        let sent = 0;
        const errors: string[] = [];
        for (const [index, targetId] of recipients.entries()) {
          try {
            await OBR.player.setMetadata({ [RUMBLE_CHAT_KEY]: { chatlog: message, created: new Date(Date.now() + index).toISOString(), sender: EXTENSION_NAME, targetId } });
            sent += 1;
          } catch (error) { errors.push(errorMessage(error)); }
        }
        statuses.set(context.runtimeKey, errors.length ? `partial-error: sent ${sent}/${recipients.length}; ${errors.join("; ")}` : `sent:${sent}`);
      } else if (effect.actionId === "roll-dice") {
        const notation = textParameter(effect.parameters, "notation");
        if (!notation) { statuses.set(context.runtimeKey, "invalid"); continue; }
        try {
          await OBR.player.setMetadata({ [RUMBLE_DICE_KEY]: { notation, created: new Date().toISOString(), sender: EXTENSION_NAME } });
          statuses.set(context.runtimeKey, "rolled");
        } catch (error) { statuses.set(context.runtimeKey, `error: ${errorMessage(error)}`); }
      }
    }
    return { handles: new Map(), statuses };
  }

  async clear(): Promise<void> { /* Rumble commands are discrete and have no runtime handles. */ }
}

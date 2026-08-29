export function buildRuntimeEffectKey(
  detectorId: string,
  ruleId: string,
  effectId: string,
  targetId: string,
  effectType = "",
  providerId = "",
  actionId = "",
  detectedEmitterId = "",
): string {
  return [detectorId, ruleId, effectId, targetId, effectType, providerId, actionId, detectedEmitterId]
    .map((part) => `${part.length}:${part}`).join("|");
}

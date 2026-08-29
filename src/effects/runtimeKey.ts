export function buildRuntimeEffectKey(
  detectorId: string,
  ruleId: string,
  effectId: string,
  targetId: string,
  effectType = "",
  providerId = "",
  actionId = "",
): string {
  return [detectorId, ruleId, effectId, targetId, effectType, providerId, actionId]
    .map((part) => `${part.length}:${part}`).join("|");
}

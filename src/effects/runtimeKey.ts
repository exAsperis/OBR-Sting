export function buildRuntimeEffectKey(detectorId: string, ruleId: string, effectId: string, targetId: string): string {
  return [detectorId, ruleId, effectId, targetId].map((part) => `${part.length}:${part}`).join("|");
}

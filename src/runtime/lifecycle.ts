import type { RuleEvaluation, RuleSnapshot, RuleTransition } from "../types";

export function toRuleSnapshot(evaluation: RuleEvaluation): RuleSnapshot {
  return {
    active: evaluation.strength > 0 && evaluation.detectedEmitter !== null,
    strength: evaluation.strength,
    distance: evaluation.distance,
    detectedEmitterId: evaluation.detectedEmitter?.id ?? null,
  };
}

export function deriveTransition(previous: RuleSnapshot | null, current: RuleSnapshot): RuleTransition {
  if (!previous?.active && current.active) return { type: "enter" };
  if (previous?.active && !current.active) return { type: "exit" };
  if (previous?.active && current.active && previous.detectedEmitterId !== current.detectedEmitterId) {
    return {
      type: "nearest-change",
      fromEmitterId: previous.detectedEmitterId!,
      toEmitterId: current.detectedEmitterId!,
    };
  }
  return current.active ? { type: "continuous" } : { type: "inactive" };
}

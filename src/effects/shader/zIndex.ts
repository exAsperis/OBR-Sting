const EFFECT_Z_INDEX_BASE = 1_000_000;
const EFFECT_Z_INDEX_SPAN = 1_000_000;

/** Assign overlapping local effects a repeatable draw order without shared depth. */
export function stableEffectZIndex(runtimeKey: string): number {
  let hash = 2166136261;
  for (let index = 0; index < runtimeKey.length; index += 1) {
    hash ^= runtimeKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return EFFECT_Z_INDEX_BASE + (hash >>> 0) % EFFECT_Z_INDEX_SPAN;
}

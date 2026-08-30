export function normalizeSignal(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface ParsedEmitterSignal {
  signal: string;
  range?: number;
  tag: string;
}

const RANGE_SUFFIX = /^(.*?)\[\s*(\d+(?:\.\d+)?|\.\d+)\s*\]$/;

export function parseEmitterSignal(value: string): ParsedEmitterSignal | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(RANGE_SUFFIX);
  if (!match) {
    if (trimmed.includes("[") || trimmed.includes("]")) return null;
    const signal = normalizeSignal(trimmed);
    return signal ? { signal, tag: signal } : null;
  }
  const signal = normalizeSignal(match[1]);
  const range = Number(match[2]);
  if (!signal || !Number.isFinite(range) || range <= 0) return null;
  return { signal, range, tag: `${signal}[${range}]` };
}

export function normalizeSignals(values: string[]): string[] {
  return [...new Set(values.map(parseEmitterSignal).filter((entry): entry is ParsedEmitterSignal => entry !== null).map((entry) => entry.tag))];
}

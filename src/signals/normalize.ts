export function normalizeSignal(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeSignals(values: string[]): string[] {
  return [...new Set(values.map(normalizeSignal).filter(Boolean))];
}

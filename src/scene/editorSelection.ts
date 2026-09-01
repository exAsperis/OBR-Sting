export function resolveEditorSelection(currentId: string | null, sceneSelection: string[] | undefined, itemIds: Iterable<string>): string | null {
  const available = new Set(itemIds);
  if (sceneSelection?.length === 1 && available.has(sceneSelection[0])) return sceneSelection[0];
  if (currentId && available.has(currentId)) return currentId;
  return null;
}

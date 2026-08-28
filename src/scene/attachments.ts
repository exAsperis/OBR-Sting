import type { Item } from "@owlbear-rodeo/sdk";
import type { AttachmentGraph } from "../types";

export function buildAttachmentGraph(items: Item[]): AttachmentGraph {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenById = new Map<string, Item[]>();
  for (const item of items) {
    if (!item.attachedTo) continue;
    childrenById.set(item.attachedTo, [...(childrenById.get(item.attachedTo) ?? []), item]);
  }
  const rootById = new Map<string, string>();
  for (const item of items) {
    const seen = new Set([item.id]);
    let current = item;
    while (current.attachedTo && byId.has(current.attachedTo) && !seen.has(current.attachedTo)) {
      seen.add(current.attachedTo);
      current = byId.get(current.attachedTo)!;
    }
    rootById.set(item.id, current.id);
  }
  return { byId, rootById, childrenById };
}

export function resolveParent(item: Item, graph: AttachmentGraph): Item | null {
  return item.attachedTo ? graph.byId.get(item.attachedTo) ?? null : null;
}

export function resolveCarrier(item: Item, graph: AttachmentGraph): Item {
  return graph.byId.get(graph.rootById.get(item.id) ?? item.id) ?? item;
}

export function isSameAttachmentFamily(a: Item, b: Item, graph: AttachmentGraph): boolean {
  return (graph.rootById.get(a.id) ?? a.id) === (graph.rootById.get(b.id) ?? b.id);
}

import type { Item } from "@owlbear-rodeo/sdk";

export function itemLabelText(item: Item): string {
  if (!("text" in item)) return "";
  const text = (item as Item & { text: { plainText: string } }).text.plainText;
  if (item.type === "LABEL") return text;
  return item.type === "IMAGE" && "textItemType" in item && item.textItemType === "LABEL" ? text : "";
}

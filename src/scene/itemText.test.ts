import { describe, expect, it } from "vitest";
import type { Item } from "@owlbear-rodeo/sdk";
import { itemLabelText } from "./itemText";

const item = (value: object) => value as Item;

describe("itemLabelText", () => {
  it("reads standalone labels", () => {
    expect(itemLabelText(item({ type: "LABEL", text: { plainText: "Door" } }))).toBe("Door");
  });

  it("reads image label text and rejects ordinary image text", () => {
    expect(itemLabelText(item({ type: "IMAGE", textItemType: "LABEL", text: { plainText: "Guard" } }))).toBe("Guard");
    expect(itemLabelText(item({ type: "IMAGE", textItemType: "PLAIN", text: { plainText: "Ignored" } }))).toBe("");
  });

  it("rejects items without qualifying text", () => {
    expect(itemLabelText(item({ type: "SHAPE" }))).toBe("");
  });
});

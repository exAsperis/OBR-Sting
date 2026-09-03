// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@owlbear-rodeo/sdk";
import { StrictMode } from "react";

const picker = vi.hoisted(() => ({ pickSceneItem: vi.fn(), cancelItemPick: vi.fn() }));
vi.mock("../runtime/itemPicker", () => picker);
import { pickedRuleValue, SpecificItemField } from "./ItemPickerField";

const items = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] as Item[];

describe("SpecificItemField", () => {
  it("keeps the dropdown and maps a picked item to its id", async () => {
    const onChange = vi.fn();
    picker.pickSceneItem.mockResolvedValue(items[1]);
    render(<SpecificItemField items={items} value="a" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Specific item"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(await screen.findByRole("button", { name: "Pick" })).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  it("rejects a target that is unavailable to the field", async () => {
    picker.pickSceneItem.mockResolvedValue({ id: "missing" } as Item);
    render(<SpecificItemField items={items} value="a" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot be used");
  });

  it("returns to Pick after completion under React Strict Mode", async () => {
    let resolvePick!: (item: Item) => void;
    picker.pickSceneItem.mockReturnValue(new Promise<Item>((resolve) => { resolvePick = resolve; }));
    render(<StrictMode><SpecificItemField items={items} value="a" onChange={vi.fn()} /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByRole("button", { name: "Picking…" })).toBeTruthy();
    resolvePick(items[1]);
    expect(await screen.findByRole("button", { name: "Pick" })).toBeTruthy();
  });
});

describe("pickedRuleValue", () => {
  it("maps item names independently of rule match configuration", () => {
    expect(pickedRuleValue({ name: "  Alpha  " } as Item, "item-name")).toBe("Alpha");
  });

  it("maps supported labels and rejects unsupported text", () => {
    expect(pickedRuleValue({ name: "", type: "LABEL", text: { plainText: "  Door  " } } as unknown as Item, "item-label")).toBe("Door");
    expect(pickedRuleValue({ name: "", type: "IMAGE", textItemType: "PLAIN", text: { plainText: "No" } } as unknown as Item, "item-label")).toBe("");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignalCombobox } from "./SignalCombobox";

describe("SignalCombobox", () => {
  it("filters existing signals without regard to case and selects one", () => {
    const onChange = vi.fn();
    render(<SignalCombobox value="MAG" options={["magic", "sound"]} onChange={onChange} onEnter={vi.fn()} />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "magic" }));
    expect(onChange).toHaveBeenCalledWith("magic");
  });

  it("adds the typed signal with Enter", () => {
    const onEnter = vi.fn();
    render(<SignalCombobox value="alarm" options={[]} onChange={vi.fn()} onEnter={onEnter} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledOnce();
  });
});

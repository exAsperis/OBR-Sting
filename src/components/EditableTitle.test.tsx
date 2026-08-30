import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableTitle } from "./EditableTitle";

afterEach(cleanup);

describe("EditableTitle", () => {
  it("selects the current title and commits a renamed value", () => {
    const onChange = vi.fn();
    render(<EditableTitle value="Old name" fallback="Glow" onChange={onChange} ariaLabel="Rename effect" />);
    fireEvent.click(screen.getByRole("button", { name: "Old name" }));
    const input = screen.getByRole("textbox", { name: "Rename effect" });
    expect((input as HTMLInputElement).value).toBe("Old name");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("New name");
  });

  it("removes a custom name when reset to the fallback", () => {
    const onChange = vi.fn();
    render(<EditableTitle value="Custom" fallback="Face" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Face" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

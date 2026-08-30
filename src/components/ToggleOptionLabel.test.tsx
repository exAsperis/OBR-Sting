import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToggleOptionLabel } from "./ToggleOptionLabel";

afterEach(cleanup);

describe("ToggleOptionLabel", () => {
  it("exposes and toggles its pressed state", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ToggleOptionLabel label="Color" option="Gradient" active={false} onChange={onChange} activeTitle="Disable" inactiveTitle="Enable" />);
    const button = screen.getByRole("button", { name: "Gradient" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<ToggleOptionLabel label="Color" option="Gradient" active onChange={onChange} activeTitle="Disable" inactiveTitle="Enable" />);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

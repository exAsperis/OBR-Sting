import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrengthLinkLabel } from "./StrengthLinkLabel";

afterEach(cleanup);

describe("StrengthLinkLabel", () => {
  it("activates an endpoint exclusively", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StrengthLinkLabel label="Rate" onChange={onChange} />);
    const min = screen.getByRole("button", { name: "MIN" });
    const max = screen.getByRole("button", { name: "MAX" });
    expect(min.getAttribute("aria-pressed")).toBe("false");
    expect(max.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(max);
    expect(onChange).toHaveBeenLastCalledWith("max");
    rerender(<StrengthLinkLabel label="Rate" value="max" onChange={onChange} />);
    expect(min.getAttribute("aria-pressed")).toBe("false");
    expect(max.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(min);
    expect(onChange).toHaveBeenLastCalledWith("min");
  });

  it("turns off the active endpoint", () => {
    const onChange = vi.fn();
    render(<StrengthLinkLabel label="Rate" value="min" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "MIN" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

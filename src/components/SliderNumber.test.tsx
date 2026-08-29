import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SliderNumber } from "./SliderNumber";

afterEach(cleanup);

describe("SliderNumber", () => {
  it("updates through the slider", () => {
    const onChange = vi.fn();
    render(<SliderNumber label="Beam end" value={150} min={1} max={200} step={1} onChange={onChange} suffix="%" />);
    fireEvent.change(screen.getByRole("slider", { name: "Beam end" }), { target: { value: "175" } });
    expect(onChange).toHaveBeenCalledWith(175);
  });

  it("opens the displayed value for precise editing and commits on blur", () => {
    const onChange = vi.fn();
    render(<SliderNumber label="Rate" value={1} min={0} max={10} step={0.1} decimals={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Rate: 1" }));
    const input = screen.getByRole("spinbutton", { name: "Edit Rate" });
    fireEvent.change(input, { target: { value: "2.7" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(2.7);
  });
});

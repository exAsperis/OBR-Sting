import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SliderNumber } from "./SliderNumber";
import { NumericLimitsProvider } from "./NumericLimits";

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

  it("allows manual precision finer than the slider step", () => {
    const onChange = vi.fn();
    render(<SliderNumber label="Pivot X" value={0} min={-500} max={500} step={5} inputStep={1} onChange={onChange} suffix="%" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Pivot X: 0" }));
    const input = screen.getByRole("spinbutton", { name: "Edit Pivot X" });
    fireEvent.change(input, { target: { value: "13" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(13);
  });

  it("can replace the slider with a direct editor", () => {
    const onChange = vi.fn();
    render(<SliderNumber label="Responsive offset" value={20} min={-100} max={100} step={1} editReplacesSlider onChange={onChange} suffix="%" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Responsive offset: 20" }));
    expect(screen.queryByRole("slider", { name: "Responsive offset" })).toBeNull();
    const input = screen.getByRole("spinbutton", { name: "Edit Responsive offset" });
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(35);
    expect(screen.getByRole("slider", { name: "Responsive offset" })).toBeTruthy();
  });

  it("focuses the entry field and provides cancel and apply buttons", () => {
    const onChange = vi.fn();
    render(<SliderNumber label="Rate" value={1} min={0} max={10} step={0.1} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Rate: 1" }));
    const input = screen.getByRole("spinbutton", { name: "Edit Rate" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing Rate" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit Rate: 1" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Edit Rate" }), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Rate" }));
    expect(onChange).toHaveBeenCalledWith(2.5);
  });

  it("allows and flags an out-of-bounds value when numerical limits are overridden", () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumericLimitsProvider value><SliderNumber label="Rate" value={1} min={0} max={10} step={1} onChange={onChange} /></NumericLimitsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Edit Rate: 1" }));
    const input = screen.getByRole("spinbutton", { name: "Edit Rate" });
    expect(input.hasAttribute("min")).toBe(false);
    expect(input.hasAttribute("max")).toBe(false);
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(15);
    rerender(<NumericLimitsProvider value><SliderNumber label="Rate" value={15} min={0} max={10} step={1} onChange={onChange} /></NumericLimitsProvider>);
    expect(screen.getByRole("slider", { name: "Rate" }).classList.contains("out-of-bounds")).toBe(true);
  });
});

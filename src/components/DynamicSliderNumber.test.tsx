import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamicSliderNumber } from "./DynamicSliderNumber";

afterEach(cleanup);

describe("DynamicSliderNumber", () => {
  it("enables a minimum-to-current range", () => {
    const onRangeChange = vi.fn();
    render(<DynamicSliderNumber label="Inner radius" value={34} min={0} max={99} step={1} onChange={vi.fn()} onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "DYN" }));
    expect(onRangeChange).toHaveBeenCalledWith({ minimum: 0, maximum: 34 });
  });

  it("uses the maximum endpoint as the static value when disabled", () => {
    const onChange = vi.fn();
    const onRangeChange = vi.fn();
    render(<DynamicSliderNumber label="Outer radius" value={118} range={{ minimum: 80, maximum: 140 }} min={35} max={200} step={1} onChange={onChange} onRangeChange={onRangeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "DYN" }));
    expect(onChange).toHaveBeenCalledWith(140);
    expect(onRangeChange).toHaveBeenCalledWith({ minimum: 80, maximum: 140, enabled: false });
  });
});

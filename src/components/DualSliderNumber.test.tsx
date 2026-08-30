import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DualSliderNumber } from "./DualSliderNumber";

afterEach(cleanup);

describe("DualSliderNumber", () => {
  it("shows both values with one unit and updates either endpoint", () => {
    const onChange = vi.fn();
    render(<DualSliderNumber label="Responsive offset" labelContent={<span>Responsive offset</span>} minimumValue={-20} maximumValue={60} min={-100} max={100} step={1} suffix="%" onChange={onChange} />);
    expect(screen.getByLabelText("Edit Responsive offset: -20 to 60").textContent).toBe("-20 – 60%");
    fireEvent.change(screen.getByRole("slider", { name: "Responsive offset at minimum detection" }), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith(10, 60);
  });

  it("allows either semantic endpoint to cross the other", () => {
    const onChange = vi.fn();
    render(<DualSliderNumber label="Responsive offset" labelContent={<span>Responsive offset</span>} minimumValue={-20} maximumValue={60} min={-100} max={100} step={1} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Responsive offset at minimum detection" }), { target: { value: "80" } });
    fireEvent.change(screen.getByRole("slider", { name: "Responsive offset at maximum detection" }), { target: { value: "-40" } });
    expect(onChange).toHaveBeenNthCalledWith(1, 80, 60);
    expect(onChange).toHaveBeenNthCalledWith(2, -20, -40);
  });

  it("replaces the slider with two editors until focus leaves the group", () => {
    const onChange = vi.fn();
    render(<DualSliderNumber label="Responsive offset" labelContent={<span>Responsive offset</span>} minimumValue={-20} maximumValue={60} min={-100} max={100} step={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Responsive offset: -20 to 60" }));
    const minimum = screen.getByRole("spinbutton", { name: "Edit Responsive offset at minimum detection" });
    const maximum = screen.getByRole("spinbutton", { name: "Edit Responsive offset at maximum detection" });
    fireEvent.change(minimum, { target: { value: "15" } });
    fireEvent.blur(minimum, { relatedTarget: maximum });
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
    fireEvent.change(maximum, { target: { value: "-35" } });
    fireEvent.blur(maximum);
    expect(onChange).toHaveBeenCalledWith(15, -35);
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("constrains descending endpoints from crossing", () => {
    const onChange = vi.fn();
    render(<DualSliderNumber label="Detection range" labelContent={<span>Detection range</span>} minimumValue={60} maximumValue={5} min={0} step={0.5} order="descending" minimumEndpointLabel="Outer range" maximumEndpointLabel="Full strength at" onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Outer range" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("slider", { name: "Full strength at" }), { target: { value: "80" } });
    expect(onChange).toHaveBeenNthCalledWith(1, 5, 5);
    expect(onChange).toHaveBeenNthCalledWith(2, 60, 60);
  });
});

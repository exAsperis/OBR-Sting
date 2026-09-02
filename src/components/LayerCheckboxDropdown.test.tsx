import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerCheckboxDropdown } from "./LayerCheckboxDropdown";

afterEach(cleanup);

describe("LayerCheckboxDropdown", () => {
  it("summarizes ignored layers and toggles them with checkboxes", () => {
    const onChange = vi.fn();
    render(<LayerCheckboxDropdown layers={["MAP", "GRID", "POST_PROCESS"]} value={["MAP", "GRID"]} onChange={onChange} />);

    expect(screen.getByText("2 layers ignored")).toBeTruthy();
    fireEvent.click(screen.getByText("2 layers ignored"));
    fireEvent.click(screen.getByRole("checkbox", { name: "POST PROCESS" }));
    expect(onChange).toHaveBeenCalledWith(["MAP", "GRID", "POST_PROCESS"]);
  });
});

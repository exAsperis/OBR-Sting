// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightEffectEditor } from "../integrations/ui/IntegrationEffectEditor";
import type { LightEffectDefinitionV1 } from "../../types";

const effect = (action: LightEffectDefinitionV1["action"]): LightEffectDefinitionV1 => ({
  id: "light-1", type: "light", enabled: true, action, duration: "temporary",
  target: action === "add" ? { type: "detector" } : { type: "detected-emitter" },
  audience: { type: "everyone" }, attenuationRadius: { value: 4 }, sourceRadius: { value: 0 },
  falloff: { value: 0.5 }, innerAngle: { value: 360 }, outerAngle: { value: 360 }, lightType: "PRIMARY",
});

const renderEditor = (value: LightEffectDefinitionV1) => render(<LightEffectEditor effect={value} items={[]} providerEnabled onSave={vi.fn()} onChange={vi.fn()} onDelete={vi.fn()} />);

describe("LightEffectEditor duration", () => {
  it("offers temporary and permanent duration for Add Light", () => {
    renderEditor(effect("add"));
    const duration = screen.getByText("Duration").closest("label")!.querySelector("select")!;
    expect([...duration.options].map((option) => option.text)).toEqual([
      "Temporary — reverse when trigger clears",
      "Permanent — leave in scene",
    ]);
  });

  it("offers the same duration setting for Modify Light", () => {
    renderEditor(effect("modify"));
    expect(screen.getByText("Duration")).not.toBeNull();
    expect(screen.getByRole("option", { name: "Permanent — leave in scene" })).not.toBeNull();
  });

  it("shows Face and Speed controls for Spotlight without radius controls", () => {
    renderEditor(effect("spotlight"));
    expect(screen.getByText("Face")).not.toBeNull();
    expect(screen.getByText("Speed")).not.toBeNull();
    expect(screen.getByText("Light target")).not.toBeNull();
    expect(screen.queryByRole("option", { name: "Detected emitter(s)" })).toBeNull();
    expect(screen.queryByText("Radius (scene units)")).toBeNull();
    expect(screen.getByText("Duration")).not.toBeNull();
  });
});

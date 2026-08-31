// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightEffectEditor } from "../integrations/ui/IntegrationEffectEditor";
import type { LightEffectDefinitionV1 } from "../../types";

const effect = (action: "add" | "modify"): LightEffectDefinitionV1 => ({
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
      "Temporary — remove when trigger clears",
      "Permanent — keep after trigger clears",
    ]);
  });

  it("hides duration for Modify Light", () => {
    renderEditor(effect("modify"));
    expect(screen.queryByText("Duration")).toBeNull();
  });
});

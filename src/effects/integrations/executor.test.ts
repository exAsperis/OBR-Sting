import { describe, expect, it, vi } from "vitest";
import type { DesiredEffect, IntegrationEffectDefinitionV1 } from "../../types";
import { IntegrationEffectExecutor } from "./executor";
import { IntegrationProviderRegistry } from "./registry";
import type { IntegrationProvider } from "./types";

function provider(id = "test-provider"): IntegrationProvider {
  return {
    id,
    displayName: "Test Provider",
    schemaVersion: 1,
    actions: [{ id: "fire", displayName: "Fire", allowedLifecycles: ["enter"], stateful: false, execution: "single-authority", audienceMode: "public-only", validateParameters: () => [] }],
    getAvailability: async () => ({ status: "available", checkedAt: Date.now() }),
    validate: () => [],
    reconcile: vi.fn(async () => ({ handles: new Map(), statuses: new Map() })),
    clear: vi.fn(async () => undefined),
  };
}

describe("IntegrationProviderRegistry", () => {
  it("rejects duplicate trusted provider IDs", () => {
    const registry = new IntegrationProviderRegistry();
    registry.register(provider());
    expect(() => registry.register(provider())).toThrow(/Duplicate integration provider/);
  });
});

describe("IntegrationEffectExecutor", () => {
  it("reconciles registered providers even with an empty desired set so they can clean up", async () => {
    const registry = new IntegrationProviderRegistry();
    const registered = provider();
    registry.register(registered);
    const executor = new IntegrationEffectExecutor(registry);
    await executor.reconcile({ desired: [], events: [] });
    expect(registered.reconcile).toHaveBeenCalledWith({ desired: [], events: [] });
  });

  it("retains unknown provider effects as unavailable instead of throwing", async () => {
    const registry = new IntegrationProviderRegistry();
    const executor = new IntegrationEffectExecutor(registry);
    const effect: IntegrationEffectDefinitionV1 = {
      id: "effect", type: "integration", enabled: true, lifecycle: "enter",
      target: { type: "detector" }, audience: { type: "everyone" },
      providerId: "future", providerSchemaVersion: 1, actionId: "fire", parameters: {},
    };
    const context = { effect, runtimeKey: "runtime", localPlayer: { id: "gm", role: "GM" }, audienceMatch: true } as DesiredEffect;
    const report = await executor.reconcile({ desired: [], events: [context] });
    expect(report.statuses.get("runtime")).toBe("provider-unavailable");
  });
});

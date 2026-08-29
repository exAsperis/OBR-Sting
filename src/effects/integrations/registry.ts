import type { IntegrationProvider } from "./types";

export class IntegrationProviderRegistry {
  private readonly providers = new Map<string, IntegrationProvider>();

  register(provider: IntegrationProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`Duplicate integration provider: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  get(id: string): IntegrationProvider | undefined { return this.providers.get(id); }
  list(): readonly IntegrationProvider[] { return [...this.providers.values()]; }
}

import { AurasEmanationsProvider } from "./aurasEmanations/provider";
import { IntegrationProviderRegistry } from "../registry";

/** Trusted providers compiled into this Sting build. This is not a runtime plugin API. */
export function createIntegrationProviderRegistry(): IntegrationProviderRegistry {
  const providers = new IntegrationProviderRegistry();
  providers.register(new AurasEmanationsProvider());
  return providers;
}

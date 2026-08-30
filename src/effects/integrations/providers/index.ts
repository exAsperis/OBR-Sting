import { AurasEmanationsProvider } from "./aurasEmanations/provider";
import { IntegrationProviderRegistry } from "../registry";
import { RumbleProvider } from "./rumble/provider";

/** Trusted providers compiled into this Sting build. This is not a runtime plugin API. */
export function createIntegrationProviderRegistry(): IntegrationProviderRegistry {
  const providers = new IntegrationProviderRegistry();
  providers.register(new AurasEmanationsProvider());
  providers.register(new RumbleProvider());
  return providers;
}

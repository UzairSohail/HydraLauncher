import type { ProviderRegistry } from "../provider-registry";
import { codebergProvider } from "./codeberg";
import { customJsonProvider } from "./custom-json";
import { githubProvider } from "./github";
import { gitlabProvider } from "./gitlab";
import { hydraCatalogProvider } from "./hydra-catalog";
import { itchioProvider } from "./itchio";

export const registerBuiltInProviders = (registry: ProviderRegistry) => {
  for (const provider of [
    hydraCatalogProvider,
    githubProvider,
    gitlabProvider,
    codebergProvider,
    itchioProvider,
  ]) {
    registry.register(provider, { builtIn: true });
  }

  registry.register(customJsonProvider);
};

export {
  codebergProvider,
  customJsonProvider,
  githubProvider,
  gitlabProvider,
  hydraCatalogProvider,
  itchioProvider,
};
export { HYDRA_CATALOG_PROVIDER_ID, toCatalogLocator } from "./hydra-catalog";

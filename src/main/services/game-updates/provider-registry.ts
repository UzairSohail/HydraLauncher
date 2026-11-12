import type { UpdateProviderInfo } from "@types";

import type { UpdateProvider } from "./update-provider";

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface RegisteredProvider {
  provider: UpdateProvider;
  isBuiltIn: boolean;
}

export interface RegisterProviderOptions {
  /** Replaces a provider with the same id instead of throwing. */
  replace?: boolean;
  builtIn?: boolean;
}

/** Providers can be added or removed at any time; listeners hear about each change. */
export class ProviderRegistry {
  private readonly providers = new Map<string, RegisteredProvider>();
  private readonly listeners = new Set<() => void>();

  register(
    provider: UpdateProvider,
    { replace = false, builtIn = false }: RegisterProviderOptions = {}
  ): () => void {
    if (!PROVIDER_ID.test(provider.id)) {
      throw new Error(`Invalid update provider id: ${provider.id}`);
    }
    if (this.providers.has(provider.id) && !replace) {
      throw new Error(`Update provider already registered: ${provider.id}`);
    }

    const entry = { provider, isBuiltIn: builtIn };
    this.providers.set(provider.id, entry);
    this.emit();

    return () => {
      if (this.providers.get(provider.id) === entry) {
        this.unregister(provider.id);
      }
    };
  }

  unregister(id: string): boolean {
    const removed = this.providers.delete(id);
    if (removed) this.emit();
    return removed;
  }

  get(id: string): UpdateProvider | null {
    return this.providers.get(id)?.provider ?? null;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): UpdateProvider[] {
    return [...this.providers.values()].map(({ provider }) => provider);
  }

  describe(): UpdateProviderInfo[] {
    return [...this.providers.values()].map(({ provider, isBuiltIn }) => ({
      id: provider.id,
      displayName: provider.displayName,
      inputExample: provider.inputExample,
      supportsChannels: provider.supportsChannels,
      supportsDownloads: provider.supportsDownloads,
      isBuiltIn,
      isImplicit: provider.isImplicit === true,
    }));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A broken listener must not stop registration.
      }
    }
  }
}

import type { UpdateAsset, UpdateChannel, UpdateRelease } from "@types";

export interface ProviderHttp {
  getJson: <T>(
    url: string,
    options?: { headers?: Record<string, string>; signal?: AbortSignal }
  ) => Promise<T>;
}

export interface FetchLatestOptions {
  channel: UpdateChannel;
  http: ProviderHttp;
  signal?: AbortSignal;
}

/**
 * A place that publishes releases. The scheduler, badges and rollback only use
 * this interface, so a new provider needs nothing beyond `registry.register()`.
 */
export interface UpdateProvider {
  readonly id: string;
  readonly displayName: string;
  readonly inputExample: string;
  readonly supportsChannels: boolean;
  readonly supportsDownloads: boolean;
  /** Added to every installed port instead of being chosen by the user. */
  readonly isImplicit?: boolean;

  /** Turns what the user typed into a stable locator, or null if it isn't one. */
  parseInput(input: string): string | null;
  getSourceUrl(locator: string): string | null;
  fetchLatest(
    locator: string,
    options: FetchLatestOptions
  ): Promise<UpdateRelease | null>;
  /** Overrides the default file picking, for providers that know the install target. */
  selectAsset?(release: UpdateRelease, platform: string): UpdateAsset | null;
}

export class UpdateProviderError extends Error {
  constructor(
    readonly code: "not_found" | "rate_limited" | "invalid_response",
    message?: string
  ) {
    super(message ?? code);
  }
}

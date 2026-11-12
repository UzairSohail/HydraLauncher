import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProviderRegistry } from "./provider-registry.js";
import type { UpdateProvider } from "./update-provider.js";

const makeProvider = (id: string, displayName = id): UpdateProvider => ({
  id,
  displayName,
  inputExample: "x",
  supportsChannels: false,
  supportsDownloads: true,
  parseInput: (input) => input,
  getSourceUrl: () => null,
  fetchLatest: async () => null,
});

describe("ProviderRegistry", () => {
  it("registers and looks up providers at runtime", () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider("custom"));

    assert.equal(registry.get("custom")?.displayName, "custom");
    assert.deepEqual(
      registry.describe().map(({ id, isBuiltIn }) => ({ id, isBuiltIn })),
      [{ id: "custom", isBuiltIn: false }]
    );
  });

  it("rejects duplicates unless replacing", () => {
    const registry = new ProviderRegistry();
    registry.register(makeProvider("custom", "First"));

    assert.throws(() => registry.register(makeProvider("custom")));
    registry.register(makeProvider("custom", "Second"), { replace: true });
    assert.equal(registry.get("custom")?.displayName, "Second");
  });

  it("rejects invalid ids", () => {
    assert.throws(() =>
      new ProviderRegistry().register(makeProvider("Has Spaces"))
    );
  });

  it("notifies listeners and unregisters through the returned handle", () => {
    const registry = new ProviderRegistry();
    let changes = 0;
    registry.onChange(() => changes++);

    const unregister = registry.register(makeProvider("custom"));
    unregister();

    assert.equal(registry.has("custom"), false);
    assert.equal(changes, 2);
  });

  it("does not let a stale handle remove a replacement", () => {
    const registry = new ProviderRegistry();
    const unregisterFirst = registry.register(makeProvider("custom", "First"));
    registry.register(makeProvider("custom", "Second"), { replace: true });

    unregisterFirst();
    assert.equal(registry.get("custom")?.displayName, "Second");
  });
});

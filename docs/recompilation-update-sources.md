# Recompilation update sources

Installed recompilations are checked for new versions in the background. Each
port always has its catalog release as a source, and users can add more from
the port page (⋯ → Update sources): the official repo, forks, nightly or
pre-release channels, and itch.io pages.

## How it fits together

| Piece                | Where                                                      | Job                                                                                      |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `UpdateProvider`     | `src/main/services/game-updates/update-provider.ts`        | Turns user input into a locator and fetches a source's latest release                    |
| `ProviderRegistry`   | `src/main/services/game-updates/provider-registry.ts`      | Holds the providers; add or remove them at any time                                      |
| Built-in providers   | `src/main/services/game-updates/providers/`                | `catalog` (implicit), `github`, `gitlab`, `codeberg`, `itchio`                           |
| Scheduler and state  | `src/main/services/game-updates/recompilation-updates.ts`  | Daily checks with backoff, notifications, best-source choice                             |
| Backups and rollback | `src/main/events/recompilation/recompilation-installer.ts` | Save snapshot and copy of the current version before every update; swap back on rollback |

The scheduler, the library badge, the update button and rollback only see
`UpdateProvider` and the stored source state. None of them know about a
specific provider.

## Adding a provider

```ts
import { updateProviders, type UpdateProvider } from "@main/services/game-updates";

const myProvider: UpdateProvider = {
  id: "my-forge",
  displayName: "My Forge",
  inputExample: "https://forge.example.org/owner/repo",
  supportsChannels: true,
  supportsDownloads: true,
  parseInput: (input) => /* normalized locator or null */,
  getSourceUrl: (locator) => `https://forge.example.org/${locator}/releases`,
  fetchLatest: async (locator, { channel, http }) => {
    const releases = await http.getJson<unknown>(/* releases API */);
    return /* newest UpdateRelease allowed by `channel`, or null */;
  },
};

const unregister = updateProviders.register(myProvider);
```

Registering or unregistering emits a change. The renderer reloads the provider
list, and the scheduler runs a check. Sources whose provider is missing are kept
and shown as unavailable until it comes back.

Optional members:

- `selectAsset(release, platform)` replaces the default file picking. Without it,
  the file is chosen by OS, then architecture, then how closely its name matches
  the installed file. A user's file filter (substring or `/regex/`) takes priority.
- `isImplicit` adds the provider to every port instead of the add-source form.

Releases with no downloadable asset, like the itch.io ones, are manual: the
update opens `release.pageUrl` instead of installing.

## Update and rollback behaviour

- Before an update is extracted, the port's saves (from
  `recompilation-saves.json`) are copied to
  `userData/recompilation-save-snapshots/<slug>/`, keeping the last 5. The
  current install is copied to `<install>.previous`. If either backup fails,
  the update is cancelled.
- Rollback swaps `<install>` and `<install>.previous`, so it can be undone the
  same way. Saves stored inside the install folder are carried into the restored
  version, so progress isn't lost.
- A version counts as newer by dotted-number comparison. Rolling tags such as
  `nightly` count as newer when the installed source republishes them after the
  install date.

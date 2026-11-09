# Personal cloud saves

This fork syncs game saves through [Cloud Save Manager](https://github.com/UzairSohail/cloud-save-manager),
a personal Google Drive sync, instead of Hydra Cloud. Hydra links Cloud Save
Manager's Rust library into `hydra-native` and opens the same state folder as the
Cloud Save Manager app, so both share this device's Google sign-in, game
catalogue, sync base and "playing" markers. A save made through Hydra on one
device shows up for Cloud Save Manager on another, and the reverse.

## How it works

- **Sign in:** Settings, Integrations, Cloud saves (Google Drive). If the Cloud
  Save Manager app is already signed in on this device, Hydra is too.
- **Matching games:** Hydra matches a game to Cloud Save Manager's shared
  catalogue by its exe name, as Cloud Save Manager's own devices do. Generic exe
  names such as `game.exe` also need the game's name to match. A game the
  catalogue doesn't know yet has its saves detected, or found from what changed
  during its first session, or set by choosing the save folder.
- **Before launch:** Hydra pulls a newer save if the cloud is ahead. It never
  holds the game back for more than a minute.
- **While playing:** Hydra marks the game as playing, so Cloud Save Manager's
  watcher leaves it alone.
- **After exit:** Hydra waits for the save files to stop changing, then uploads.
  Conflicts settle by Cloud Save Manager's rule: the newest save wins and the
  other stays in version history.
- **Linux:** Windows games run through Wine or Proton use Hydra's own Wine prefix
  for save locations. Native Linux games aren't synced.
- **Game page:** the cloud button opens the game's Cloud saves settings, with
  status, Sync now, upload or download this device's save, and restore or delete
  versions.
- **Hydra's own files:** `PersonalCloud.readFile` and `writeFile` store files
  under `hydra/` in the Drive folder, for example synced settings.

Hydra Cloud stays in the code for accounts that already have it. Without a
subscription, its cloud save buttons and upsell are hidden.

## Building

Cloud Save Manager is a private repository, so building `hydra-native` needs git
access to it. If Cargo can't fetch it, set `CARGO_NET_GIT_FETCH_WITH_CLI=true` so
it uses your git credentials. The dependency is pinned by commit in
`native/hydra-native/Cargo.toml`.

Google sign-in needs Cloud Save Manager's OAuth client, because Drive's
`drive.file` scope only shows files to the client that created them. Either set
`CSM_GOOGLE_CLIENT_ID` and `CSM_GOOGLE_CLIENT_SECRET` when building, as Cloud
Save Manager's release workflow does, or sign in once with the Cloud Save Manager
app, which leaves a `client.json` in its state folder. Anyone with a built app
can extract a built-in client, so keep builds private.

For testing, `CSM_STATE_DIR` and `CSM_REMOTE_DIR` point Hydra at another state
folder and at a local folder instead of Google Drive.

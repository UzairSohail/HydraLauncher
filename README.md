<div align="center">

<img src="./resources/icon.png" width="144" alt="Nacho Launcher icon"/>

  <h1 align="center">Nacho Launcher</h1>

  <p align="center">
    <strong>Nacho Launcher is a personal gaming launcher for managing your whole game library, with saves, settings and achievements synced across your devices through your own Google Drive. It is built on the open-source <a href="https://github.com/hydralauncher/hydra">Hydra Launcher</a> (Electron, React, TypeScript and Rust).</strong>
  </p>

[![release](https://img.shields.io/github/v/release/UzairSohail/NachoLauncher)](https://github.com/UzairSohail/NachoLauncher/releases/latest)
[![build](https://img.shields.io/github/actions/workflow/status/UzairSohail/NachoLauncher/release.yml?branch=master)](https://github.com/UzairSohail/NachoLauncher/actions/workflows/release.yml)

</div>

## Features

- Add the games you own to one library and browse a rich catalogue
- Download through a debrid service (AllDebrid recommended) or direct download links
- Get notified when a game you downloaded has an update, and update it in place
- Cloud saves through your own Google Drive ([details](docs/personal-cloud-saves.md))
- Settings, achievements and collections synced across devices ([settings sync](docs/settings-sync.md), [achievement sync](docs/achievement-sync.md))
- Updates itself from this repo's [Releases](https://github.com/UzairSohail/NachoLauncher/releases), including the Linux AppImage on SteamOS
- Android companion app ([details](docs/companion-app.md))

## Download

Grab the latest installer or AppImage from [Releases](https://github.com/UzairSohail/NachoLauncher/releases/latest). Once installed, Nacho Launcher keeps itself up to date.

## Build from source and contributing

The upstream Hydra docs still apply to building from source: [docs.hydralauncher.gg](https://docs.hydralauncher.gg/getting-started)

### Local development requirements

- Node.js + Yarn
- Rust toolchain (for `hydra-native`)
- Git and a C++ toolchain (Visual Studio C++ Build Tools on Windows, GCC/Clang on Linux, Xcode command-line tools on macOS). The native build obtains CMake and CTest automatically through vcpkg.

After installing dependencies, `postinstall` now builds the Rust native addon automatically (`hydra-native/hydra-native.node`).

The native build includes a Rust wrapper around pinned libtorrent. Development and packaged torrenting no longer require Python.

On Windows x64 and Linux x64, the libtorrent bridge comes prebuilt from `native/torrent-bridge/prebuilt`, so installs skip compiling libtorrent through vcpkg. Other platforms build it from source. When a branch push changes `native/torrent-bridge` or `scripts/build-torrent-bridge.cjs`, the "Torrent bridge prebuilts" workflow rebuilds the binaries and commits them to that branch; until then, installs build the bridge from source. Set `HYDRA_TORRENT_BRIDGE_FROM_SOURCE=1` to always build it from source.

## Credits

Nacho Launcher is based on [Hydra Launcher](https://github.com/hydralauncher/hydra) by Los Broxas and its contributors.

## License

Nacho Launcher, like Hydra, is licensed under the [MIT License](LICENSE).

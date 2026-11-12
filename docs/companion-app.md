# Nacho Companion (phone app)

An Android app (in `companion/`) that links to your launchers through your
Google Drive. From your phone you can:

- browse and search the catalogue,
- see each computer's library and what's installed,
- queue a download on a chosen computer, or on whichever computer opens Nacho Launcher
  first, from the download option you pick,
- follow queued downloads,
- add and remove download sources for all your computers.

There's no server. The phone and every launcher read and write small files in
the same `Cloud Save Manager/hydra/` Drive folder that settings sync already
uses.

## How it works

| File | Written by | What's in it |
| --- | --- | --- |
| `hydra/companion.json` | the phone | Download requests, and the list of computer ids |
| `hydra/devices/<id>.json` | each launcher | Its name, free space, a short library list, and what it did with each request |
| `hydra/settings.json` | launchers and phone | Settings sync. The phone only changes `downloadSources` |

Each file has a single writer, so nothing overwrites anything. The files stay
small: no images or catalogue data are stored (the phone gets those from the
catalogue API), and the phone removes requests once they're finished. A
launcher with a few hundred games comes to a few tens of KB.

The launcher (`src/main/services/companion/`) checks for requests 20 seconds
after it starts and then every 90 seconds while it's open. For each request it
picks the download the same way the download dialog would: your preferred
debrid service (AllDebrid first) when one is set up, otherwise a direct
download. Torrents are only ever downloaded through debrid. If something else is
downloading, the game is added to the queue.

For "first computer to open Nacho Launcher" requests, a launcher writes a claim in its
own file, waits 30 seconds, and goes ahead only if no other computer claimed it
earlier.

Settings > Integrations > **Nacho Companion** on each computer sets the name the phone
shows and can turn off downloads from the phone for that computer.

The file formats are in `src/shared/companion.ts`, which both apps use.

## One-time setup

### 1. Register the app with Google

The phone app must be in the **same Google Cloud project** as the launcher's
Google sign-in (the one whose client ID is in the `CSM_GOOGLE_CLIENT_ID`
secret). Google only lets an app see Drive files made by its own project, so a
different project would see an empty Drive.

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
with that project selected:

1. **Create credentials > OAuth client ID**, application type **Android**.
2. Package name: `com.nacho.companion`
3. SHA-1 certificate fingerprint: the fingerprint of the signing key (below).
4. Optional but recommended: also create an OAuth client of type **Web
   application** and put its client ID in a repository **variable** named
   `GOOGLE_WEB_CLIENT_ID`.

If the consent screen is in Testing mode, your Google account must be on its
test users list, as it already is for the launcher.

### 2. Signing key

Android apps need a fixed signing key, and Google sign-in checks its SHA-1.
Add two repository **secrets** (Settings > Secrets and variables > Actions):

- `ANDROID_KEYSTORE_BASE64`: the keystore file, base64 encoded
- `ANDROID_KEYSTORE_PASSWORD`: its password (used for the store and the key,
  alias `nacho`)

To make your own instead:

```sh
keytool -genkeypair -keystore nacho-phone.jks -alias nacho -keyalg RSA \
  -keysize 2048 -validity 10000 -dname "CN=Nacho Phone App"
keytool -list -v -keystore nacho-phone.jks -alias nacho | grep SHA1
base64 -w0 nacho-phone.jks   # macOS: base64 -i nacho-phone.jks
```

Keep the keystore safe. A different key means Android won't install the new
APK over the old one, and Google needs the new fingerprint.

### 3. Build

Actions > **Nacho Companion** > Run workflow. It publishes `NachoCompanion.apk` as the
`phone-app` pre-release, replacing the previous build. The desktop Release
workflow and the launcher's auto-update ignore that release.

Install the APK on your phone (allow installs from your browser when asked) and
sign in with the same Google account as the launcher.

## Developing

```sh
cd companion
npm ci
npx tsc --noEmit
npx expo run:android   # needs Android Studio, or use the workflow
```

`EXPO_PUBLIC_API_URL` overrides the catalogue API, and
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` sets the web client ID.

# Signing in to Google from a phone

Handhelds such as the ROG Xbox Ally X in SteamOS game mode have no easy
browser or keyboard, so Nacho Launcher can finish Google sign-in on a phone
instead. It uses Google's sign-in for "TVs and Limited Input devices":

1. The launcher asks Google for a short code and shows it with a QR code of
   Google's device page (google.com/device).
2. The user scans the QR code with their phone, types the code, picks their
   Google account and allows access.
3. The launcher polls Google until the sign-in finishes, then saves the token
   like a browser sign-in and starts syncing.

The scope is the same `drive.file` as the browser sign-in, so the same Drive
files are used and nothing about Google verification changes.

## Setup

In the same Google Cloud project as the desktop client
(`CSM_GOOGLE_CLIENT_ID`), create an OAuth client of type
**TVs and Limited Input devices** and add two repository secrets:

- `NACHO_GOOGLE_DEVICE_CLIENT_ID`
- `NACHO_GOOGLE_DEVICE_CLIENT_SECRET`

The Release workflow builds them into hydra-native. Without them the
"Sign in with your phone" buttons are hidden.

## How the token keeps working

A refresh token only works with the client that issued it. After a phone
sign-in, `native/hydra-native/src/google_device.rs` writes the device client
to the shared Cloud Save Manager state folder's `client.json` (which Cloud
Save Manager already prefers over its built-in client), with a
`nacho_device_client` marker. A later browser sign-in sees the marker, signs
in with the built-in desktop client instead, and removes the file once the
new token is saved.

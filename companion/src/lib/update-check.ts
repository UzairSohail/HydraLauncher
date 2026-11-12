import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Alert, Linking } from "react-native";

/**
 * The phone app is published as the "phone-app" release of the launcher's
 * public repo, titled "Nacho Companion (build N)". Every build's Android
 * versionCode is that same N, so a higher N on the release means an update.
 */
const RELEASE_URL =
  "https://api.github.com/repos/UzairSohail/NachoLauncher/releases/tags/phone-app";
const SKIPPED_KEY = "update-check:skipped-build";

interface Release {
  name: string | null;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

export interface AvailableUpdate {
  build: number;
  downloadUrl: string;
}

/** This install's build number, or null in a development build. */
export function installedBuild(): number | null {
  const code = Constants.expoConfig?.android?.versionCode;
  if (typeof code === "number" && code > 1) return code;
  const match = /^1\.0\.(\d+)$/.exec(Constants.expoConfig?.version ?? "");
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

export async function findUpdate(): Promise<AvailableUpdate | null> {
  const installed = installedBuild();
  if (installed === null) return null;

  const response = await fetch(RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return null;
  const release = (await response.json()) as Release;

  const build = Number(/build (\d+)/i.exec(release.name ?? "")?.[1]);
  if (!Number.isFinite(build) || build <= installed) return null;

  const apk = release.assets.find((asset) => asset.name.endsWith(".apk"));
  return { build, downloadUrl: apk?.browser_download_url ?? release.html_url };
}

/**
 * Checks once at startup and offers the new APK. "Later" stays quiet until a
 * newer build than the one skipped comes out. Never throws.
 */
export async function offerUpdate() {
  try {
    const update = await findUpdate();
    if (!update) return;
    const skipped = Number(await AsyncStorage.getItem(SKIPPED_KEY));
    if (skipped >= update.build) return;

    Alert.alert(
      "Update available",
      "A newer version of Nacho Companion is out. Download it and open the file to install it over this one. Your sign-in is kept.",
      [
        {
          text: "Later",
          style: "cancel",
          onPress: () => {
            void AsyncStorage.setItem(SKIPPED_KEY, String(update.build));
          },
        },
        {
          text: "Download",
          onPress: () => {
            void Linking.openURL(update.downloadUrl);
          },
        },
      ]
    );
  } catch {
    // Offline or GitHub unavailable: try again next launch.
  }
}

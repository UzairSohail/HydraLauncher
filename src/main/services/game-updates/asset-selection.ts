import type { UpdateAsset } from "@types";

type Os = "windows" | "linux" | "macos";

const NOT_INSTALLABLE =
  /\.(sha\d*|md5|sig|asc|txt|json|xml|pdb|sym|debug|dbg|deb|rpm|flatpak|snap|dmg|pkg|msi|apk|ipa|whl)$|(^|[^a-z])(source|src|symbols|debug)([^a-z]|$)/i;

const OS_PATTERNS: Record<Os, RegExp> = {
  windows: /(^|[^a-z])(win(dows)?(32|64)?|w64|msvc|mingw)([^a-z]|$)|\.exe$/i,
  linux:
    /(^|[^a-z])(linux|ubuntu|steamos|steamdeck|deck)([^a-z]|$)|\.appimage$|\.tar\.(gz|xz|bz2|zst)$/i,
  macos: /(^|[^a-z])(mac(os)?|osx|darwin|apple)([^a-z]|$)|\.app\.(zip|tar)/i,
};

const ARM = /(^|[^a-z0-9])(arm64|aarch64|arm)([^a-z0-9]|$)/i;
const X64 = /(^|[^a-z0-9])(x64|x86[_-]64|amd64|win64)([^a-z0-9]|$)/i;
const X86 = /(^|[^a-z0-9])(x86|i[36]86|win32)([^a-z0-9]|$)/i;
const ARCHIVE = /\.(zip|7z|rar|tar\.(gz|xz|bz2|zst)|tgz)$/i;

const toOs = (platform: string): Os | null => {
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  return null;
};

/** `/pattern/` is a regular expression; anything else is a substring. */
export const matchesAssetFilter = (name: string, filter: string) => {
  const regex = /^\/(.+)\/([a-z]*)$/i.exec(filter.trim());
  if (regex) {
    try {
      return new RegExp(
        regex[1],
        regex[2].includes("i") ? regex[2] : `${regex[2]}i`
      ).test(name);
    } catch {
      return false;
    }
  }
  return name.toLowerCase().includes(filter.trim().toLowerCase());
};

/** Removes version numbers so `port-1.2-win.zip` and `port-1.3-win.zip` compare equal. */
export const assetNameShape = (name: string) =>
  name
    .toLowerCase()
    .replace(/v?\d+(?:[._-]\d+)*(?:[-.]?(alpha|beta|rc|pre)\.?\d*)?/g, "#")
    .replace(/#+/g, "#");

export interface AssetSelectionOptions {
  platform: string;
  arch: string;
  filter?: string | null;
  /** The file the current install came from; its naming wins over guessing. */
  previousAssetName?: string | null;
}

export const selectReleaseAsset = (
  assets: UpdateAsset[],
  { platform, arch, filter, previousAssetName }: AssetSelectionOptions
): UpdateAsset | null => {
  const os = toOs(platform);
  if (!os) return null;

  const candidates = filter?.trim()
    ? assets.filter((asset) => matchesAssetFilter(asset.name, filter))
    : assets.filter((asset) => !NOT_INSTALLABLE.test(asset.name));
  const previousShape = previousAssetName
    ? assetNameShape(previousAssetName)
    : null;
  const wantsArm = arch === "arm64";

  let best: { asset: UpdateAsset; score: number } | null = null;
  for (const asset of candidates) {
    const { name } = asset;
    const otherOs = (Object.keys(OS_PATTERNS) as Os[]).filter(
      (key) => key !== os && OS_PATTERNS[key].test(name)
    );
    const ownOs = OS_PATTERNS[os].test(name);
    if (!ownOs && otherOs.length > 0 && !filter?.trim()) continue;

    let score = ownOs ? 10 : 0;
    if (previousShape && assetNameShape(name) === previousShape) score += 20;
    if (ARM.test(name)) score += wantsArm ? 4 : -6;
    else if (X64.test(name)) score += wantsArm ? -2 : 3;
    else if (X86.test(name)) score -= 2;
    if (ARCHIVE.test(name)) score += 1;
    if (os === "linux" && /\.appimage$/i.test(name)) score += 1;

    if (!best || score > best.score) best = { asset, score };
  }

  return best?.asset ?? null;
};

import type { UpdateRelease } from "@types";

const NUMERIC = /^(\d+(?:\.\d+)*)(.*)$/;

export const normalizeVersion = (version: string) =>
  version.trim().replace(/^v(?=\d)/i, "");

/** Returns null when either side isn't a dotted number, e.g. `nightly`. */
export const compareVersions = (left: string, right: string) => {
  const a = NUMERIC.exec(normalizeVersion(left));
  const b = NUMERIC.exec(normalizeVersion(right));
  if (!a || !b) return null;

  const leftParts = a[1].split(".").map(Number);
  const rightParts = b[1].split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  const leftSuffix = a[2].replace(/^[-+._]/, "");
  const rightSuffix = b[2].replace(/^[-+._]/, "");
  if (leftSuffix === rightSuffix) return 0;
  // 1.2 is newer than 1.2-rc1.
  if (!leftSuffix) return 1;
  if (!rightSuffix) return -1;
  return Math.sign(
    leftSuffix.localeCompare(rightSuffix, undefined, { numeric: true })
  );
};

export interface InstalledRelease {
  version: string | null;
  installedAt: string | null;
  sourceId: string | null;
}

const toTime = (value: string | null) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

export const isNewerRelease = (
  release: UpdateRelease,
  sourceId: string,
  installed: InstalledRelease
) => {
  if (!installed.version) return false;

  const published = toTime(release.publishedAt);
  const installedAt = toTime(installed.installedAt);
  const isPublishedAfterInstall =
    published !== null && installedAt !== null && published > installedAt;

  if (
    normalizeVersion(release.version) === normalizeVersion(installed.version)
  ) {
    // A rolling tag such as `nightly` keeps its name and gets new files.
    return sourceId === installed.sourceId && isPublishedAfterInstall;
  }

  const comparison = compareVersions(release.version, installed.version);
  if (comparison !== null) return comparison > 0;
  return published === null || installedAt === null || isPublishedAfterInstall;
};

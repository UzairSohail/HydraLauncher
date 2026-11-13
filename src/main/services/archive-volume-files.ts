// Split archives come as volumes: Game.part01.rar, Game.7z.001 or
// Game.rar + Game.r00. Only the first volume is handed to 7-Zip, which reads
// the rest itself, but every volume is an archive file to clean up afterwards.
const SPLIT_VOLUME = /\.(?:7z|zip|rar)\.\d{3}$/i;
const OLD_RAR_VOLUME = /\.r\d{2}$/i;
const RAR_PART = /\.part\d+\.rar$/i;
const ARCHIVE = /\.(?:7z|zip|rar)$/i;

export const isArchiveVolumeFile = (fileName: string) =>
  ARCHIVE.test(fileName) ||
  SPLIT_VOLUME.test(fileName) ||
  OLD_RAR_VOLUME.test(fileName);

export const isFirstArchiveVolume = (fileName: string) => {
  if (RAR_PART.test(fileName)) return /\.part0*1\.rar$/i.test(fileName);
  if (SPLIT_VOLUME.test(fileName)) return /\.0*1$/.test(fileName);
  if (OLD_RAR_VOLUME.test(fileName)) return false;
  return ARCHIVE.test(fileName);
};

/** Numbered volumes the in-place extractor should not be given. */
export const isNumberedSplitVolume = (fileName: string) =>
  SPLIT_VOLUME.test(fileName);
